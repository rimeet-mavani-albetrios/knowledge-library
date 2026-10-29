// The facts runner: collects small facts about each website (who runs it, how old it is, its app rating…),
// a few links at a time, and keeps them fresh. Each kind of fact is one file in ./kinds that default-exports:
//   { kind, everyDays, perRun, needs: ['ENV_NAME'], async collect(link, facts, ctx) → value | null,
//     async changes?(link, oldValue, newValue) → [{ kind, data }] }
// and optionally `sources` (['web'] = only websites, not GitHub or YouTube links), `order` (lower runs first, so a
// kind can use another one's result) and `ai: true` (it asks the free AI, so it waits while the AI rests).
// collect() returning null means "checked, nothing found". Throwing means "try again in about a day".
// After any change the trust grade (trust.js) is worked out again.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { query } from '../db.js';
import { toLink } from '../links.js';
import { AiPaused, aiState, aiTask, fillMode } from '../robot/ai.js';
import { gradeTrust } from './trust.js';
import { siteContext } from './site.js';

const DAY = 24 * 3600_000;
const AT_ONCE = 3; // links checked at the same time
// The link's own columns, without the long page text and the meaning fingerprint.
const COLUMNS = `l.id, l.url, l.title, l.description, l.summary, l.use_for, l.features, l.category, l.tags, l.user_tags,
  l.pricing, l.source, l.site_name, l.author, l.image_url, l.icon_url, l.github, l.note, l.collection, l.status,
  l.ai_status, l.error, l.health, l.created_at, l.updated_at, l.tasks, l.level, l.favorite, l.my_status, l.opens,
  l.opened_at, l.page_links`;

let kindsLoading = null;
let running = false;
const collecting = new Set(); // link ids being checked right now because you opened them

export function loadKinds() {
  kindsLoading ??= (async () => {
    const dir = path.join(import.meta.dirname, 'kinds');
    const files = (await fs.readdir(dir).catch(() => [])).filter(file => file.endsWith('.js')).sort();
    const kinds = [];
    for (const file of files) {
      try {
        const { default: kind } = await import(pathToFileURL(path.join(dir, file)).href);
        if (kind?.kind && typeof kind.collect === 'function') kinds.push(kind);
        else console.warn(`Facts: ${file} is not a fact kind (it needs a default export with kind and collect)`);
      } catch (err) {
        console.error(`Facts: could not load ${file}:`, err.message);
      }
    }
    return kinds.sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
  })();
  return kindsLoading;
}

const hasKeys = kind => (kind.needs ?? []).every(name => process.env[name]);
const fits = (kind, link) => !kind.sources || kind.sources.includes(link.source);
const due = (kind, checked = {}) => !checked[kind.kind] || Date.parse(checked[kind.kind]) < Date.now() - (kind.everyDays ?? 30) * DAY;
const aiResting = () => !aiState().enabled || aiState().paused;

// The kinds this link still waits for: they fit it, their keys are set, and they were never checked or are old.
export async function pendingKinds(link, checked) {
  return (await loadKinds()).filter(kind => hasKeys(kind) && fits(kind, link) && due(kind, checked)).map(kind => kind.kind);
}

export const isCollecting = id => collecting.has(id);

async function saveFact(linkId, kind, value, at = new Date()) {
  const { rows } = await query(
    `INSERT INTO link_facts (link_id, facts, checked) VALUES ($1, jsonb_build_object($2::text, $3::jsonb), jsonb_build_object($2::text, $4::text))
     ON CONFLICT (link_id) DO UPDATE SET facts = link_facts.facts || jsonb_build_object($2::text, $3::jsonb),
       checked = link_facts.checked || jsonb_build_object($2::text, $4::text), updated_at = now()
     RETURNING facts, checked`,
    [linkId, kind, JSON.stringify(value ?? null), at.toISOString()],
  );
  return rows[0];
}

// Something went wrong (a website was slow): keep the old value and try again in about a day.
async function retryLater(linkId, kind) {
  const at = new Date(Date.now() - Math.max((kind.everyDays ?? 30) - 1, 0) * DAY);
  await query(
    `INSERT INTO link_facts (link_id, checked) VALUES ($1, jsonb_build_object($2::text, $3::text))
     ON CONFLICT (link_id) DO UPDATE SET checked = link_facts.checked || jsonb_build_object($2::text, $3::text)`,
    [linkId, kind.kind, at.toISOString()],
  );
}

async function updateTrust(linkId, facts) {
  const trust = gradeTrust(facts);
  if (JSON.stringify(trust) === JSON.stringify(facts.trust ?? null)) return;
  facts.trust = trust;
  await saveFact(linkId, 'trust', trust);
}

// One kind for one link. Gives back false when the free AI is resting (nothing was saved).
async function checkOne(kind, link, facts) {
  const old = facts[kind.kind];
  // Filling for Claude (server/scripts/fill-facts.js): this run only writes down the questions; nothing is saved.
  const recording = kind.ai && fillMode() === 'record';
  let value;
  try {
    // The name of this check, so each question to the AI can be named "company:abc123:0".
    value = await aiTask.run({ key: `${kind.kind}:${link.id}`, n: 0 }, () => kind.collect(link, facts, siteContext(link)));
  } catch (err) {
    if (err instanceof AiPaused || recording) return false;
    console.warn(`Facts: ${kind.kind} failed for ${link.url}: ${err.message}`);
    await retryLater(link.id, kind);
    return true;
  }
  if (recording) return false;
  const saved = await saveFact(link.id, kind.kind, value);
  Object.assign(facts, saved.facts);
  if (kind.changes) {
    const rows = await Promise.resolve(kind.changes(link, old ?? null, value ?? null)).catch(err => {
      console.warn(`Facts: ${kind.kind} changes failed for ${link.url}: ${err.message}`);
      return [];
    });
    for (const row of rows ?? []) {
      await query('INSERT INTO link_history (link_id, kind, data) VALUES ($1, $2, $3)', [link.id, row.kind, JSON.stringify(row.data ?? {})]);
    }
  }
  await updateTrust(link.id, facts);
  return true;
}

// The given kinds for one link. Kinds with the same `order` run at the same time; a later order waits, so it can
// use the earlier ones' results (company uses wikidata, age uses archive). Gives back the kinds that were done.
async function checkLink(link, facts, kinds) {
  const done = [];
  for (const order of [...new Set(kinds.map(kind => kind.order ?? 50))]) {
    const group = kinds.filter(kind => (kind.order ?? 50) === order && !(kind.ai && aiResting()) && !kind.resting?.());
    const results = await Promise.all(group.map(kind => checkOne(kind, link, facts)));
    done.push(...group.filter((kind, i) => results[i]).map(kind => kind.kind));
  }
  return done;
}

function toFactLink(row) {
  return { ...toLink(row), pageLinks: row.page_links ?? [], row };
}

// The links one kind should check next: never checked or checked too long ago; favorites and most-opened first.
async function linksFor(kind, limit) {
  const { rows } = await query(
    `SELECT ${COLUMNS}, coalesce(f.facts, '{}') AS f_facts
     FROM links l LEFT JOIN link_facts f ON f.link_id = l.id
     WHERE l.status = 'ready' AND ($1::text[] IS NULL OR l.source = ANY($1))
       AND (f.checked ->> $2 IS NULL OR (f.checked ->> $2)::timestamptz < now() - make_interval(days => $3))
     ORDER BY l.favorite DESC, l.opens DESC, l.created_at DESC
     LIMIT $4`,
    [kind.sources ?? null, kind.kind, kind.everyDays ?? 30, limit],
  );
  return rows;
}

// The background round. Each kind names up to `perRun` links it should check next; then those links are checked
// one by one (a few at a time), favorites and most-opened first, until the time budget is used. Going link by link
// means a link gets all its facts at once, and the kinds share one read of its home page.
// Answers { checked, byKind } so the daily wake-up can log what happened.
// For filling the whole library at once (server/scripts/fill-facts.js): `only` (kind names), `perRun` (links per
// kind instead of each kind's own number) and `atOnce` (links checked at the same time).
export async function runFacts({ budgetMs = 60_000, only = null, perRun = null, atOnce = AT_ONCE } = {}) {
  if (running) return { checked: 0, byKind: {}, skipped: 'already running' };
  running = true;
  const stopAt = Date.now() + budgetMs;
  const byKind = {};
  try {
    const plan = new Map(); // link id → { row, kinds }
    for (const kind of await loadKinds()) {
      if (only && !only.includes(kind.kind)) continue;
      // `resting`: a kind whose free daily limit is used up (YouTube) waits for tomorrow.
      if (!hasKeys(kind) || (kind.ai && aiResting()) || kind.resting?.()) continue;
      for (const row of await linksFor(kind, perRun ?? kind.perRun ?? 10)) {
        if (!plan.has(row.id)) plan.set(row.id, { row, kinds: [] });
        plan.get(row.id).kinds.push(kind);
      }
    }
    const todo = [...plan.values()].sort(
      (a, b) => b.row.favorite - a.row.favorite || b.row.opens - a.row.opens || b.row.created_at - a.row.created_at,
    );
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(atOnce, todo.length) }, async () => {
        while (next < todo.length && Date.now() < stopAt) {
          const { row, kinds } = todo[next++];
          if (collecting.has(row.id)) continue;
          for (const kind of await checkLink(toFactLink(row), row.f_facts, kinds)) byKind[kind] = (byKind[kind] ?? 0) + 1;
        }
      }),
    );
  } finally {
    running = false;
  }
  const checked = Object.values(byKind).reduce((sum, n) => sum + n, 0);
  if (checked) console.log(`Facts: checked ${checked} (${Object.entries(byKind).map(([kind, n]) => `${kind} ${n}`).join(', ')})`);
  return { checked, byKind };
}

// You opened a link whose facts aren't known yet: check them now, in the background.
export async function collectNow(id) {
  if (collecting.has(id)) return;
  collecting.add(id);
  try {
    const { rows } = await query(
      `SELECT ${COLUMNS}, coalesce(f.facts, '{}') AS f_facts, coalesce(f.checked, '{}') AS f_checked
       FROM links l LEFT JOIN link_facts f ON f.link_id = l.id WHERE l.id = $1`,
      [id],
    );
    if (!rows[0] || rows[0].status !== 'ready') return;
    const link = toFactLink(rows[0]);
    const kinds = (await loadKinds()).filter(kind => hasKeys(kind) && !kind.resting?.() && fits(kind, link) && due(kind, rows[0].f_checked));
    await checkLink(link, rows[0].f_facts, kinds);
  } catch (err) {
    console.error(`Facts: could not check ${id}:`, err.message);
  } finally {
    collecting.delete(id);
  }
}
