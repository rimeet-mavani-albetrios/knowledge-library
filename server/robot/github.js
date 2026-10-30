// Extra details for GitHub repositories: stars, language, topics, license and the README text, and where the
// repository's owner is (for the link's country).

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

// GitHub's hourly limit, as its last answer told it: without a token only 60 questions an hour for everything the
// robot asks (new repos, stars, owners' countries), so the slower jobs can check what's left before asking.
const limit = { left: null, resetAt: 0 };

// The account behind a repository or a profile page: "github.com/yt-dlp/yt-dlp" and "github.com/yt-dlp" → "yt-dlp".
export function parseOwner(input) {
  const repo = parseRepo(input);
  if (repo) return repo.owner;
  try {
    const url = new URL(input);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname.replace(/^www\./, '') !== 'github.com' || parts.length !== 1) return null;
    return NOT_OWNERS.has(parts[0].toLowerCase()) ? null : parts[0];
  } catch {
    return null;
  }
}

function githubFetch(path, accept = 'application/vnd.github+json') {
  const headers = { accept, 'user-agent': 'knowledge-library-robot', 'x-github-api-version': '2022-11-28' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(20_000) }).then(res => {
    const left = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (res.headers.has('x-ratelimit-remaining') && Number.isFinite(left) && Number.isFinite(reset)) {
      limit.left = left;
      limit.resetAt = reset * 1000;
    }
    return res;
  });
}

// { left, resetAt }: questions left this hour and when the count starts again. `left` is null while unknown.
export function githubLimit() {
  return Date.now() < limit.resetAt ? { ...limit } : { left: null, resetAt: 0 };
}

// GitHub said no because the hour's questions are used up: try again after `retryAt` (a time in ms).
export class GithubLimited extends Error {
  constructor(retryAt) {
    super('GitHub’s hourly limit is used up');
    this.retryAt = retryAt;
  }
}

// The person or company behind a repository: the "location" they typed on their profile ("Bengaluru, India").
// Returns null when GitHub can't be reached, { missing: true } when the account is gone.
export async function readOwner(login) {
  const res = await githubFetch(`/users/${encodeURIComponent(login)}`);
  if (res.status === 404) return { missing: true };
  if ((res.status === 403 || res.status === 429) && limit.left === 0) throw new GithubLimited(limit.resetAt);
  if (!res.ok) return null;
  const user = await res.json();
  return { login: user.login ?? login, type: user.type ?? null, location: clean(user.location) || null };
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
