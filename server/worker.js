// The robot. It works in the background inside the server:
// it takes "queued" links one by one, reads the website, asks the free AI, and saves the result.
// It also does small chores (retrying AI summaries, updating links read by an older robot, the weekly broken-link check)
// when the library is used, so the database can sleep when nobody visits and the free plan lasts.
import { query, getMeta, setMeta } from './db.js';
import { toLink, knownTags, tidyOldTags, repairOldUrls } from './links.js';
import { isDead } from './robot/page.js';
import { readSite } from './robot/site.js';
import { parseRepo, readRepo } from './robot/github.js';
import { basicDescription, cleanTitle, normalizeTags } from './robot/describe.js';
import { describeWithAi, aiEnabled, aiState, AiPaused } from './robot/ai.js';
import { embed, meaningText, toSqlVector } from './robot/embed.js';
import { hostOf, prettyUrl } from './robot/url.js';
import { runFacts } from './facts/runner.js';

// Raise this when the robot learns to collect something new: links read by an older robot are then read again.
export const ROBOT_VERSION = 4; // 4: spaces between the parts of a page, so words don't stick together
const WORKERS = Number(process.env.ROBOT_WORKERS) || 2; // links read at the same time (more for a big import)
const MAX_ATTEMPTS = 3;
const MAX_CONTENT = 24_000; // letters of page text saved for search
const UPGRADES_PER_ROUND = 20;
const SOURCE_TAGS = { github: 'GitHub', youtube: 'YouTube' };
let running = 0;
let upgrading = false;
let lastChores = 0;

export function kick() {
  while (running < WORKERS) {
    running++;
    work()
      .catch(err => console.error('Robot error:', err))
      .finally(() => running--);
  }
}

async function work() {
  for (;;) {
    const { rows } = await query(
      `UPDATE links SET status = 'reading', updated_at = now()
       WHERE id = (SELECT id FROM links WHERE status = 'queued' ORDER BY created_at DESC LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
    );
    if (!rows[0]) return;
    await processLink(rows[0]);
  }
}

async function save(id, fields) {
  const sets = Object.keys(fields).map((column, i) => `${column} = $${i + 2}`);
  await query(`UPDATE links SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [id, ...Object.values(fields)]);
}

// `quiet` is for links that are already in the library and only get the newest details:
// their card stays as it is while the robot works, and a good AI description is never replaced by a worse one.
async function processLink(row, { quiet = false } = {}) {
  try {
    // 1. Read the website: the page plus up to 3 useful pages of it (and GitHub details for repositories).
    const repoRef = parseRepo(row.url);
    const [page, repo] = await Promise.all([
      readSite(row.url, { extraPages: row.source === 'web' }),
      repoRef ? readRepo(repoRef).catch(() => null) : null,
    ]);
    const isRepo = Boolean(repo && !repo.missing);
    if (quiet && !page.ok && !isRepo) {
      // Can't read it right now: keep what the library already knows.
      await query('UPDATE links SET robot_version = $2 WHERE id = $1', [row.id, ROBOT_VERSION]);
      return;
    }
    const host = hostOf(page.finalUrl || row.url);
    const siteName = isRepo ? 'GitHub' : page.siteName || host;
    const extra = page.extra ?? [];
    const link = {
      url: row.url,
      title: (isRepo && repoRef.isRoot ? repo.fullName : cleanTitle(page.title ?? '', siteName, host)) || prettyUrl(row.url),
      // When GitHub's API is busy, the page itself still says "GitHub - owner/repo: description".
      description: ((isRepo && repo.description) || githubPageDescription(page.title) || page.description || '').slice(0, 500),
      siteName,
      author: isRepo ? repo.owner : page.author || '',
      imageUrl: page.image || '',
      iconUrl: isRepo ? '' : page.icon || '',
      source: row.source,
      github: isRepo ? repo.stats : null,
      health: page.dead || repo?.missing ? 'broken' : 'ok',
      keywords: page.keywords ?? [],
      // The page's own full title often says what it does: "Ollama · Run AI models locally and in the cloud".
      headings: [...new Set([page.title, ...(page.headings ?? []), ...extra.flatMap(other => other.headings)].filter(Boolean))].slice(0, 30),
      pageLinks: page.links ?? [],
      pagesRead: extra.map(other => ({ url: other.url, title: other.title, label: other.label })),
    };
    const text = repo?.readme || page.text || '';
    const content = [text, ...extra.map(other => other.text)].join('\n\n').slice(0, MAX_CONTENT);
    if (!quiet) {
      await save(row.id, {
        title: link.title,
        description: link.description,
        site_name: link.siteName,
        author: link.author,
        image_url: link.imageUrl,
        icon_url: link.iconUrl,
        github: link.github ? JSON.stringify(link.github) : null,
        health: link.health,
        status: 'summarizing',
      });
    }

    // 2. The description: the AI's version, or the basic one when the AI can't help right now.
    const known = await knownTags();
    let described = { title: link.title, ...basicDescription(link, text) };
    let aiStatus = aiEnabled() ? 'pending' : 'basic';
    let error = '';
    if (aiEnabled()) {
      try {
        const answer = await describeWithAi({ ...link, text, extra, knownTags: known });
        described = { ...answer, title: answer.title || link.title, summary: answer.summary || described.summary };
        aiStatus = 'done';
      } catch (err) {
        if (err instanceof AiPaused) {
          if (quiet) return; // the free AI is resting: this link is tried again in a later round
        } else {
          error = err.message;
          if (row.attempts + 1 >= MAX_ATTEMPTS) aiStatus = 'failed';
          console.warn(`AI could not describe ${row.url}: ${err.message}`);
        }
      }
    }
    // A quiet update only adds details. It keeps the name, summary, category and tags the link already has
    // (you may have edited them), except when the AI now writes the first real description of a link.
    if (quiet && (aiStatus !== 'done' || row.ai_status === 'done')) {
      described = {
        ...described,
        title: row.title,
        summary: row.summary,
        useFor: row.use_for,
        features: row.features,
        category: row.category,
        pricing: row.pricing,
        tags: [...row.tags, ...(aiStatus === 'done' ? described.tags : [])],
      };
      if (aiStatus !== 'done') {
        aiStatus = row.ai_status;
        error = row.error;
      }
    }
    const sourceTag = SOURCE_TAGS[row.source];
    const tags = normalizeTags([...(row.user_tags ?? []), ...described.tags, ...(sourceTag ? [sourceTag] : [])], known);
    const full = { ...link, ...described, tags, collection: row.collection, note: row.note };

    // 3. Meaning fingerprint for smart search, then save everything.
    const vector = toSqlVector(await embed(meaningText(full)));
    await query(
      `UPDATE links SET title = $2, description = $3, site_name = $4, author = $5, image_url = $6, icon_url = $7, github = $8,
         health = $9, summary = $10, use_for = $11, features = $12, category = $13, tags = $14, pricing = $15, overview = $16,
         tasks = $17, audience = $18, quick_start = $19, level = $20, search_words = $21, headings = $22, page_links = $23,
         pages_read = $24, content = $25, embedding = $26::vector, ai_status = $27, error = $28, attempts = attempts + $29,
         status = 'ready', robot_version = $30, updated_at = now()
       WHERE id = $1`,
      [
        row.id, full.title, full.description, full.siteName, full.author, full.imageUrl, full.iconUrl,
        full.github ? JSON.stringify(full.github) : null, full.health, full.summary, full.useFor, JSON.stringify(full.features),
        full.category, tags, full.pricing, full.overview ?? '', full.tasks ?? [], full.audience ?? '', full.quickStart ?? [],
        full.level ?? '', full.searchWords ?? [], full.headings, JSON.stringify(full.pageLinks), JSON.stringify(full.pagesRead),
        content, vector, aiStatus, error, quiet ? 0 : 1, ROBOT_VERSION,
      ],
    );
  } catch (err) {
    console.error(`Could not process ${row.url}:`, err);
    if (quiet) await query('UPDATE links SET robot_version = $2 WHERE id = $1', [row.id, ROBOT_VERSION]);
    else await save(row.id, { status: 'failed', error: String(err.message ?? err).slice(0, 300), attempts: row.attempts + 1 });
  }
}

function githubPageDescription(title = '') {
  return /^GitHub - [^:]+:\s(.+)$/.exec(title)?.[1] ?? '';
}

// Links read by an older robot are read again, a few at a time, so they get the newest details too.
async function upgradeOldLinks() {
  if (upgrading) return;
  upgrading = true;
  try {
    const { rows } = await query(
      `SELECT * FROM links WHERE status = 'ready' AND robot_version < $1 ORDER BY opens DESC, created_at DESC LIMIT $2`,
      [ROBOT_VERSION, UPGRADES_PER_ROUND],
    );
    if (rows.length) console.log(`Adding the newest details to ${rows.length} older links…`);
    for (const row of rows) {
      if (aiState().paused) break;
      await processLink(row, { quiet: true });
    }
  } finally {
    upgrading = false;
  }
}

// Re-embeds a link after you edit it, so smart search knows about your changes.
export async function refreshFingerprint(id) {
  const { rows } = await query('SELECT * FROM links WHERE id = $1', [id]);
  if (!rows[0]) return;
  const link = toLink(rows[0]);
  await query('UPDATE links SET embedding = $2::vector WHERE id = $1', [id, toSqlVector(await embed(meaningText(link)))]);
}

// ---------- Chores, run at most every 15 minutes, only while someone uses the library ----------

export function choresIfDue() {
  if (Date.now() - lastChores < 15 * 60_000) return;
  lastChores = Date.now();
  chores().catch(err => console.error('Chores failed:', err));
}

async function chores() {
  // Links stuck half-way (for example the server restarted) go back in the queue.
  await query(
    `UPDATE links SET status = 'queued' WHERE status IN ('reading', 'summarizing') AND updated_at < now() - interval '10 minutes'`,
  );
  // Links that only have a basic description get another try with the AI.
  if (aiEnabled() && !aiState().paused) {
    await query(
      `UPDATE links SET status = 'queued' WHERE id IN (
         SELECT id FROM links WHERE status = 'ready' AND ai_status IN ('pending', 'basic') AND attempts < $1
         ORDER BY created_at DESC LIMIT 40)`,
      [MAX_ATTEMPTS + 2],
    );
  }
  await query(`UPDATE links SET status = 'queued' WHERE status = 'failed' AND attempts < $1`, [MAX_ATTEMPTS]);
  kick();
  if (!aiState().paused) upgradeOldLinks().catch(err => console.error('Updating older links failed:', err));
  // Website facts (facts/runner.js): a few links each round, at most 90 seconds. FACTS_RUNNER=off stops it.
  if (process.env.FACTS_RUNNER !== 'off') runFacts({ budgetMs: 90_000 }).catch(err => console.error('Website facts failed:', err));

  const lastCheck = Number(await getMeta('last_health_check'));
  if (!lastCheck) {
    await setMeta('last_health_check', Date.now()); // a new library: the first check is in a week
  } else if (Date.now() - lastCheck > 7 * 24 * 60 * 60_000) {
    await setMeta('last_health_check', Date.now());
    checkHealth().catch(err => console.error('Broken-link check failed:', err));
  }
}

// Weekly: marks links whose page is gone, and refreshes GitHub stars.
export async function checkHealth() {
  const { rows } = await query(`SELECT id, url, github, health FROM links WHERE status = 'ready' ORDER BY checked_at NULLS FIRST LIMIT 500`);
  console.log(`Checking ${rows.length} links for broken pages…`);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        const repoRef = row.github && parseRepo(row.url);
        let dead;
        let github = row.github;
        if (repoRef) {
          const repo = await readRepo(repoRef, { readme: false }).catch(() => null);
          if (repo && !repo.missing) github = repo.stats;
          dead = repo ? Boolean(repo.missing) : null;
        } else {
          dead = await isDead(row.url);
        }
        const fields = ['checked_at = now()', 'github = $2'];
        const params = [row.id, github ? JSON.stringify(github) : null];
        if (dead !== null) {
          params.push(dead ? 'broken' : 'ok');
          fields.push(`health = $3`);
        }
        await query(`UPDATE links SET ${fields.join(', ')} WHERE id = $1`, params);
        // A link that just turned broken goes in its history ("Changes this week", the weekly email).
        if (dead && row.health !== 'broken') {
          await query(`INSERT INTO link_history (link_id, kind, data) VALUES ($1, 'dead', '{}')`, [row.id]).catch(err =>
            console.error('Could not note the broken link:', err.message),
          );
        }
      }
    }),
  );
}

// At start: anything left half-way by a restart goes back in the queue.
export async function resumeQueue() {
  await tidyOldTags();
  await repairOldUrls();
  await query(`UPDATE links SET status = 'queued' WHERE status IN ('reading', 'summarizing')`);
  kick();
}
