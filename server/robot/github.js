// Extra details for GitHub repositories: stars, language, topics, license and the README text.

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// github.com/<these>/... are GitHub's own pages, not repositories.
const NOT_OWNERS = new Set([
  'about', 'apps', 'collections', 'enterprise', 'explore', 'features', 'login', 'marketplace',
  'new', 'notifications', 'orgs', 'pricing', 'search', 'settings', 'sponsors', 'topics', 'trending',
]);

export function parseRepo(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.hostname.replace(/^www\./, '') !== 'github.com') return null;
  const [owner, name, ...rest] = url.pathname.split('/').filter(Boolean);
  if (!owner || !name || NOT_OWNERS.has(owner.toLowerCase())) return null;
  return { owner, name: name.replace(/\.git$/, ''), isRoot: rest.length === 0 };
}

function githubFetch(path, accept = 'application/vnd.github+json') {
  const headers = { accept, 'user-agent': 'knowledge-library-robot', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20_000) });
}

// Returns null when GitHub can't be reached, { missing: true } when the repo was deleted.
export async function readRepo({ owner, name }, { readme = true } = {}) {
  const res = await githubFetch(`/repos/${owner}/${name}`);
  if (res.status === 404) return { missing: true };
  if (!res.ok) return null;
  const repo = await res.json();

  let readmeText = '';
  if (readme) {
    const readmeRes = await githubFetch(`/repos/${owner}/${name}/readme`, 'application/vnd.github.raw+json').catch(() => null);
    if (readmeRes?.ok) readmeText = markdownToText(await readmeRes.text()).slice(0, 8000);
  }

  return {
    name: repo.name,
    fullName: repo.full_name,
    description: clean(repo.description),
    owner: repo.owner?.login ?? owner,
    readme: readmeText,
    stats: {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language ?? null,
      topics: repo.topics ?? [],
      license: repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? repo.license.spdx_id : null,
      homepage: repo.homepage || null,
      pushedAt: repo.pushed_at,
      archived: repo.archived,
    },
  };
}

export function markdownToText(markdown) {
  return clean(
    markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/[*_`>|~]+/g, ' '),
  );
}
