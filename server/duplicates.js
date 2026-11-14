// Links you may have saved twice. Three kinds:
//   page:  the same page under two addresses (ad codes on one of them, youtu.be and youtube.com, a GitHub project's folder)
//   site:  several pages of one company's website (its home page and its pricing page)
//   title: two links with the same name on different websites ("Gupshup" on gupshup.io and gupshup.ai)
// The "Add links" window uses it to say "You have wati.io already" on a row (POST /api/links/check, in api.js).
// The owner's "Find duplicates" window lists the groups and can keep both, delete one, or merge them into one.
// Big websites like GitHub or YouTube hold many different things, so there only the same page counts, never
// "the same website" (see isPlatform in robot/domain.js).
import express from 'express';
import { requireOwner } from './auth.js';
import { query, getMeta, setMeta } from './db.js';
import { getLink } from './links.js';
import { normalizeTags } from './robot/describe.js';
import { urlKey, prettyUrl } from './robot/url.js';
import { mainDomain, isPlatform } from './robot/domain.js';
import { refreshFingerprint } from './worker.js';

const MAX_IDS = 50; // more links than any real group has
const MATCHES_SHOWN = 3; // the saved links a row in the Add window names ("Wati (+1 more page)")
const KEPT = 'duplicates_kept'; // the meta row with the groups you said are fine

// ---------- Which page, which website ----------

// Codes that only say where a click came from, on top of the ones urlKey drops already: ads ("gad_source",
// "gbraid") and "?ref=producthunt". Two addresses that differ only by these are the same page.
const CLICK_CODES = /^(gad_\w+|gbraid|wbraid|gclsrc|ref|referrer|via|si|igsh|_ga|_gl|hsa_\w+|mkt_tok|trk)$/i;
const YOUTUBE_ID = /^[\w-]{6,20}$/;

// One name for one page, whatever address it was saved under:
//   github.com/owner/project, even for a folder or file inside it (/tree/…, /blob/…)
//   youtube.com/watch?v=ID, from watch?v=, youtu.be/, /shorts/, /embed/ or /live/
//   amazon.in/dp/ASIN, from /dp/ or /gp/product/, whatever the product name in front of it
//   anything else: the address as urlKey cleans it, without the click codes above
export function pageKey(input) {
  const key = urlKey(input);
  if (!key) return null;
  const url = new URL(key);
  const site = mainDomain(key);
  const parts = url.pathname.split('/').filter(Boolean);
  if (url.hostname === 'github.com' && parts.length >= 2) return `github.com/${parts[0]}/${parts[1]}`;
  if (site === 'youtube.com' || site === 'youtu.be') {
    const id = site === 'youtu.be' ? parts[0] : url.searchParams.get('v') || (['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] : '');
    if (id && YOUTUBE_ID.test(id)) return `youtube.com/watch?v=${id}`;
  }
  if (site.startsWith('amazon.')) {
    const asin = /\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?:\/|$)/i.exec(url.pathname)?.[1];
    if (asin) return `${site}/dp/${asin.toUpperCase()}`;
  }
  const params = new URLSearchParams(url.search);
  for (const name of [...params.keys()]) if (CLICK_CODES.test(name)) params.delete(name);
  url.search = params.toString();
  return url.href.replace(/^https:\/\//, '').replace(/\/$/, '');
}

// The website two links must share to be "the same website": "docs.wati.io/x" and "wati.io" are both wati.io.
// Empty for GitHub, YouTube, shops and the like, where every page is a different thing.
export function websiteKey(input) {
  return isPlatform(input) ? '' : mainDomain(input);
}

// Names compared without capitals or extra spaces. A link the robot couldn't read yet is named after its address:
// that's no name to compare (the same address is caught as the same page anyway).
function titleKey(row) {
  const title = String(row.title ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  return title.length >= 2 && title !== prettyUrl(row.url).toLowerCase() ? title : '';
}

function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// Every link's address and name, with its page and website worked out, oldest first.
// Only the small columns: even a big library is quick to go through this way.
async function libraryRows() {
  const { rows } = await query(
    `SELECT id, url, url_key, title, icon_url, category, source, status, collection, favorite, opens, opened_at, created_at
     FROM links ORDER BY created_at, id`,
  );
  return rows.map(row => ({ ...row, page: pageKey(row.url), site: websiteKey(row.url) }));
}

// What a group's row shows: icon, name, address, added date, opens, star.
const shortLink = row => ({
  id: row.id,
  url: row.url,
  title: row.title,
  iconUrl: row.icon_url,
  category: row.category,
  source: row.source,
  status: row.status,
  collection: row.collection,
  favorite: Boolean(row.favorite),
  opens: row.opens ?? 0,
  openedAt: row.opened_at ?? null,
  createdAt: row.created_at,
});

// ---------- While adding: is this page or website saved already? ----------

// For each address: its fingerprint (key), page and website, whether this very address is saved, and else
// the saved links of the same page or the same website (`match`). The Add window also uses key, page and site
// to catch two links of one website within the same paste.
// `saved` lists the addresses already in the library, as before.
export async function checkUrls(urls) {
  const rows = await libraryRows();
  const keys = new Set(rows.map(row => row.url_key));
  const byPage = groupBy(rows, row => row.page);
  const bySite = groupBy(rows, row => row.site);
  const found = {};
  for (const url of new Set(urls)) {
    const key = urlKey(url);
    if (!key) continue;
    const info = { key, page: pageKey(url), site: websiteKey(url), saved: keys.has(key) };
    if (!info.saved) {
      const samePage = byPage.get(info.page);
      const sameSite = info.site ? bySite.get(info.site) : null;
      const [kind, links] = samePage ? ['page', samePage] : sameSite ? ['site', sameSite] : [];
      if (kind) {
        info.match = {
          kind,
          links: links.slice(0, MATCHES_SHOWN).map(row => ({ id: row.id, title: row.title, url: row.url })),
          total: links.length,
        };
      }
    }
    found[url] = info;
  }
  return { saved: urls.filter(url => found[url]?.saved), urls: found };
}

// ---------- The "Find duplicates" window ----------

// The groups you said are fine ("Keep both"): { 'site:wati.io': [ids] }. A group shows again only when a link
// that wasn't in it then joins it.
async function keptGroups() {
  try {
    return JSON.parse((await getMeta(KEPT)) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export async function keepGroup(key, ids) {
  const kept = await keptGroups();
  kept[key] = [...new Set([...(kept[key] ?? []), ...ids])];
  await setMeta(KEPT, JSON.stringify(kept));
}

// The one you'll most likely keep comes first: your favorite, then the one you open most, then the shortest
// address (the home page, or the copy without ad codes), then the oldest.
const keepFirst = (a, b) =>
  Number(b.favorite) - Number(a.favorite) ||
  (b.opens ?? 0) - (a.opens ?? 0) ||
  a.url.length - b.url.length ||
  new Date(a.created_at) - new Date(b.created_at);

export async function findDuplicates() {
  const [rows, kept] = await Promise.all([libraryRows(), keptGroups()]);
  const groups = [];
  const add = (kind, key, label, members) => {
    if (members.length < 2) return;
    if (members.every(row => kept[key]?.includes(row.id))) return; // you said these are fine
    groups.push({ key, kind, label, links: [...members].sort(keepFirst).map(shortLink) });
  };

  // The same page under two addresses.
  for (const [page, members] of groupBy(rows, row => row.page)) add('page', `page:${page}`, page, members);
  // Pages of one website. Not when they are all one page: that group is above already.
  for (const [site, members] of groupBy(rows, row => row.site)) {
    if (new Set(members.map(row => row.page)).size > 1) add('site', `site:${site}`, site, members);
  }
  // The same name on different websites. Names shared by pages of one website are in its group above.
  for (const [title, members] of groupBy(rows, titleKey)) {
    if (new Set(members.map(row => row.site || row.page)).size > 1) add('title', `title:${title}`, members[0].title, members);
  }

  // The biggest groups first, then by name.
  groups.sort((a, b) => b.links.length - a.links.length || a.label.localeCompare(b.label));
  const counts = { page: 0, site: 0, title: 0 };
  for (const group of groups) counts[group.kind]++;
  return { groups, counts };
}

// "Merge into this one": the others' tags, notes, collection, star, your status and opens move onto the link you
// keep, then the others are deleted. Their website facts and history (price changes, stars) move over too where
// the kept link has none of that kind yet, so nothing you can't collect again is lost.
// Like the repair of old addresses in links.js (repairOldUrls), which merges copies the same way.
export async function mergeLinks(keepId, otherIds) {
  const { rows } = await query(
    `SELECT id, tags, user_tags, note, collection, favorite, my_status, opens, opened_at FROM links WHERE id = ANY($1)`,
    [[keepId, ...otherIds]],
  );
  const keep = rows.find(row => row.id === keepId);
  if (!keep) return null;
  const others = rows.filter(row => row.id !== keepId);
  if (!others.length) return { link: await getLink(keepId), merged: 0 };
  const all = [keep, ...others];
  const notes = [...new Set(all.map(row => row.note.trim()).filter(Boolean))].join('\n');

  await query(
    `UPDATE links SET tags = $2, user_tags = $3, note = $4, collection = $5, favorite = $6, my_status = $7,
       opens = $8, opened_at = $9, updated_at = now() WHERE id = $1`,
    [
      keepId,
      normalizeTags(all.flatMap(row => row.tags)),
      normalizeTags(all.flatMap(row => row.user_tags)),
      notes.slice(0, 1000),
      all.find(row => row.collection)?.collection ?? '',
      all.some(row => row.favorite),
      all.find(row => row.my_status)?.my_status ?? '',
      all.reduce((sum, row) => sum + (row.opens ?? 0), 0),
      all.map(row => row.opened_at).filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] ?? null,
    ],
  );
  // One link at a time, so two others with the same kind of history don't both move over.
  for (const other of others) {
    await query(
      `UPDATE link_facts SET link_id = $1 WHERE link_id = $2 AND NOT EXISTS (SELECT 1 FROM link_facts WHERE link_id = $1)`,
      [keepId, other.id],
    );
    await query(
      `UPDATE link_history AS h SET link_id = $1 WHERE h.link_id = $2
         AND NOT EXISTS (SELECT 1 FROM link_history AS k WHERE k.link_id = $1 AND k.kind = h.kind)`,
      [keepId, other.id],
    );
  }
  await query('DELETE FROM links WHERE id = ANY($1)', [others.map(row => row.id)]);
  return { link: await getLink(keepId), merged: others.length };
}

// ---------- Routes (owner only), added to the API in api.js ----------

export const duplicatesRoutes = express.Router();

const idsFrom = value => [...new Set((Array.isArray(value) ? value : []).filter(id => typeof id === 'string' && id))].slice(0, MAX_IDS);

duplicatesRoutes.get('/duplicates', requireOwner, async (req, res) => {
  res.json(await findDuplicates());
});

// "Keep both": { key: 'site:wati.io', ids: [the group's links] }.
duplicatesRoutes.post('/duplicates/keep', requireOwner, async (req, res) => {
  const key = String(req.body?.key ?? '').slice(0, 5000); // long enough for any address (the key must match exactly)
  const ids = idsFrom(req.body?.ids);
  if (!/^(page|site|title):./.test(key) || ids.length < 2) return res.status(400).json({ error: 'Choose a group of links to keep.' });
  await keepGroup(key, ids);
  res.json({ ok: true });
});

// "Merge into this one": { keep: id, ids: [the links that go] }.
duplicatesRoutes.post('/duplicates/merge', requireOwner, async (req, res) => {
  const keep = typeof req.body?.keep === 'string' ? req.body.keep : '';
  const ids = idsFrom(req.body?.ids).filter(id => id !== keep);
  if (!keep || !ids.length) return res.status(400).json({ error: 'Choose the link to keep and the ones to merge into it.' });
  const result = await mergeLinks(keep, ids);
  if (!result?.link) return res.status(404).json({ error: 'This link is not in the library any more.' });
  // Its tags, note or collection may have changed: a new meaning fingerprint, in the background.
  if (result.merged) refreshFingerprint(keep).catch(err => console.error('Could not update the search fingerprint:', err));
  res.json(result);
});
