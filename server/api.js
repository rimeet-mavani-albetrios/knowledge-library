// The web API the website talks to. Every path starts with /api.
import express from 'express';
import { settings, CATEGORIES, PRICING } from './config.js';
import { isOwner, ownerMode, login, logout, requireOwner, requireReader } from './auth.js';
import * as links from './links.js';
import { kick, choresIfDue, refreshFingerprint } from './worker.js';
import { embedQuery, toSqlVector } from './robot/embed.js';
import { findUrls } from './robot/url.js';
import { aiState, pickWithAi, AiPaused } from './robot/ai.js';
import { exportLinks } from './export.js';
import { libraryMap } from './map.js';
import { fixSpelling } from './words.js';

export const api = express.Router();
const MAX_LINKS_PER_ADD = 1000;

// Using the library is what triggers the robot's chores (see worker.js).
api.use((req, res, next) => {
  if (req.path !== '/health') choresIfDue();
  next();
});

api.get('/health', (req, res) => res.json({ ok: true }));

api.get('/me', async (req, res) => {
  const owner = isOwner(req);
  res.json({
    owner,
    mode: ownerMode(),
    private: settings.privateLibrary,
    title: settings.title,
    ai: aiState(),
    categories: CATEGORIES,
    total: !settings.privateLibrary || owner ? await links.countLinks() : 0,
  });
});

api.post('/login', login);
api.post('/logout', logout);

// ---------- Reading ----------

const yes = value => value === '1' || value === 'true';

function readFilters(q) {
  const pick = value => (typeof value === 'string' ? value.slice(0, 100) : '');
  return {
    category: CATEGORIES.includes(q.category) ? q.category : '',
    source: ['web', 'github', 'youtube'].includes(q.source) ? q.source : '',
    collection: pick(q.collection),
    tag: pick(q.tag).trim(),
    level: links.LEVELS.includes(q.level) ? q.level : '',
    status: links.MY_STATUSES.includes(q.status) ? q.status : '',
    favorite: yes(q.favorite),
    free: yes(q.free),
    broken: yes(q.broken),
  };
}

async function queryVector(text) {
  try {
    return toSqlVector(await embedQuery(text));
  } catch (err) {
    console.error('Smart search is unavailable:', err.message);
    return null; // word search still works
  }
}

// The search text with spelling mistakes fixed. `corrected` is set when something was fixed ("Showing results for…").
async function searchText(req) {
  const typed = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  if (typed.length < 2) return { q: '', corrected: null };
  if (yes(req.query.exact)) return { q: typed, corrected: null }; // "Search for … instead"
  const corrected = await fixSpelling(typed).catch(err => {
    console.error('Spelling check failed:', err.message);
    return null;
  });
  return { q: corrected ?? typed, corrected };
}

api.get('/links', requireReader, async (req, res) => {
  const filters = readFilters(req.query);
  const limit = Math.min(Math.max(Number(req.query.limit) || settings.pageSize, 1), 60);
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
  const { q, corrected } = await searchText(req);
  if (q) {
    return res.json({ ...(await links.searchLinks({ q, vector: await queryVector(q), filters, limit, cursor })), corrected });
  }
  const sort = links.SORTS.includes(req.query.sort) ? req.query.sort : 'newest';
  // The page and the count at the same time: one wait for the database instead of two.
  const [page, total] = await Promise.all([
    links.listLinks({ filters, sort, limit, cursor }),
    cursor ? undefined : links.countLinks(filters),
  ]);
  res.json({ ...page, total, closestOnly: false });
});

api.get('/facets', requireReader, async (req, res) => {
  const { q } = await searchText(req);
  res.json(await links.facets({ q, vector: q ? await queryVector(q) : null, filters: readFilters(req.query) }));
});

// The row at the top of the home page: favorites, recently opened, "To try".
api.get('/shortcuts', requireReader, async (req, res) => {
  res.json(await links.shortcuts());
});

// Links and tags whose names match what you're typing, shown under the search box.
api.get('/suggest', requireReader, async (req, res) => {
  const q = String(req.query.q ?? '').slice(0, 100);
  res.json(await links.suggest(q));
});

// Dots for the knowledge map at the top of the page.
api.get('/map', requireReader, async (req, res) => {
  res.json({ points: await libraryMap() });
});

// Live status of links the robot is working on.
api.get('/progress', requireReader, async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').filter(Boolean).slice(0, 200);
  res.json({ items: ids.length ? await links.getLinks(ids) : [], ai: aiState() });
});

api.get('/links/:id', requireReader, async (req, res) => {
  const { q } = await searchText(req);
  const link = await links.getLink(req.params.id, q);
  if (!link) return res.status(404).json({ error: 'This link is not in the library any more.' });
  res.json({ link, similar: await links.similarLinks(link.id) });
});

// ---------- Compare: 2 to 4 links side by side ----------

const MAX_COMPARE = 4;
const compareIds = value =>
  [...new Set((Array.isArray(value) ? value : String(value ?? '').split(',')).filter(id => typeof id === 'string' && id))].slice(
    0,
    MAX_COMPARE,
  );

// The links in the order you picked them. A link deleted in the meantime is left out.
async function linksInOrder(ids) {
  const found = new Map((ids.length ? await links.getLinks(ids) : []).map(link => [link.id, link]));
  return ids.map(id => found.get(id)).filter(Boolean);
}

api.get('/compare', requireReader, async (req, res) => {
  res.json({ items: await linksInOrder(compareIds(req.query.ids)) });
});

// "Which should I pick?" Only the owner can ask: each question uses some of the free AI's daily limit.
api.post('/compare/pick', requireOwner, async (req, res) => {
  const picked = await linksInOrder(compareIds(req.body?.ids));
  if (picked.length < 2) return res.status(400).json({ error: 'Pick 2 to 4 links to compare.' });
  try {
    res.json(await pickWithAi(picked));
  } catch (err) {
    if (!(err instanceof AiPaused)) throw err;
    const minutes = Math.max(1, Math.ceil((err.until - Date.now()) / 60_000));
    res.status(503).json({
      error: Number.isFinite(err.until)
        ? `The free AI is resting for about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}. Try again then.`
        : 'The free AI is not set up yet (no Groq key).',
    });
  }
});

api.get('/export', requireOwner, async (req, res) => {
  const format = ['json', 'csv', 'html'].includes(req.query.format) ? req.query.format : 'json';
  const file = exportLinks(await links.allLinks(), format, settings.title);
  res.setHeader('content-type', file.type);
  res.setHeader('content-disposition', `attachment; filename="${file.name}"`);
  res.send(file.body);
});

// ---------- Changing (owner only) ----------

api.post('/links', requireOwner, async (req, res) => {
  const body = req.body ?? {};
  // `items` are links that bring their own tags, like the folder of a bookmark: [{ url, tags: ['AI Agents'] }].
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter(item => typeof item?.url === 'string')
    .map(item => ({ url: item.url, tags: Array.isArray(item.tags) ? item.tags.map(String) : [] }));
  const urls = [...items, ...(Array.isArray(body.urls) ? body.urls : []), ...findUrls(body.text ?? '')];
  if (!urls.length) return res.status(400).json({ error: 'No links found. Paste links that start with http:// or https://.' });
  if (urls.length > MAX_LINKS_PER_ADD) {
    return res.status(400).json({ error: `That's ${urls.length} links. Add up to ${MAX_LINKS_PER_ADD} at a time.` });
  }
  const tags = Array.isArray(body.tags) ? body.tags : String(body.tags ?? '').split(',');
  const result = await links.addLinks(urls, {
    tags,
    collection: String(body.collection ?? ''),
    note: String(body.note ?? ''),
  });
  kick();
  res.status(result.added.length ? 201 : 200).json(result);
});

// Before adding: which of the links you pasted are already saved, so the list can say so.
api.post('/links/check', requireOwner, async (req, res) => {
  const urls = (Array.isArray(req.body?.urls) ? req.body.urls : []).filter(url => typeof url === 'string').slice(0, MAX_LINKS_PER_ADD);
  res.json({ saved: await links.savedUrls(urls) });
});

api.patch('/links/:id', requireOwner, async (req, res) => {
  const changes = { ...req.body };
  if (changes.category && !CATEGORIES.includes(changes.category)) delete changes.category;
  if (changes.pricing && !PRICING.includes(changes.pricing)) delete changes.pricing;
  const { link, wordsChanged } = await links.updateLink(req.params.id, changes);
  if (!link) return res.status(404).json({ error: 'This link is not in the library any more.' });
  if (wordsChanged) refreshFingerprint(link.id).catch(err => console.error('Could not update the search fingerprint:', err));
  res.json({ link });
});

// Many links at once: { ids, action: 'tag' | 'collection' | 'refresh' | 'delete', value }.
api.post('/links/bulk', requireOwner, async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter(id => typeof id === 'string').slice(0, MAX_LINKS_PER_ADD);
  const action = req.body?.action;
  if (!ids.length || !links.BULK_ACTIONS.includes(action)) return res.status(400).json({ error: 'Choose some links and what to do with them.' });
  const value = String(req.body?.value ?? '');
  // An empty collection takes the links out of their collection; an empty tag means nothing.
  if (action === 'tag' && !value.trim()) return res.status(400).json({ error: 'Type the tag to add.' });
  const { changed, reword } = await links.bulkChange(ids, action, value);
  if (action === 'refresh') kick();
  // New meaning fingerprints, one after the other in the background, so the answer comes right away.
  (async () => {
    for (const id of reword) await refreshFingerprint(id);
  })().catch(err => console.error('Could not update the search fingerprints:', err));
  res.json({ changed });
});

// Counts an open, so the links you use most come up first. Visitors' opens don't count.
api.post('/links/:id/open', async (req, res) => {
  if (isOwner(req)) await links.recordOpen(req.params.id);
  res.json({ ok: true });
});

api.post('/tags/rename', requireOwner, async (req, res) => {
  const from = String(req.body?.from ?? '').trim();
  const to = String(req.body?.to ?? '').trim().slice(0, 40);
  if (!from || !to) return res.status(400).json({ error: 'Type the new name for the tag.' });
  res.json({ changed: await links.renameTag(from, to) });
});

api.post('/links/:id/refresh', requireOwner, async (req, res) => {
  const link = await links.requeueLink(req.params.id);
  if (!link) return res.status(404).json({ error: 'This link is not in the library any more.' });
  kick();
  res.json({ link });
});

api.delete('/links/:id', requireOwner, async (req, res) => {
  if (!(await links.deleteLink(req.params.id))) return res.status(404).json({ error: 'This link is not in the library any more.' });
  res.json({ deleted: true });
});

api.use((req, res) => res.status(404).json({ error: 'Unknown API address.' }));

// eslint-disable-next-line no-unused-vars
api.use((err, req, res, next) => {
  console.error(err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That file is too big. Split it into smaller files.' });
  res.status(500).json({ error: 'Something went wrong on the server. Try again in a moment.' });
});
