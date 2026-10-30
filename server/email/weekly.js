// What changed on your saved links in the last 7 days, for the weekly email. The facts robot writes these changes
// into link_history: new prices, new features, links that stopped working, and websites that got more popular.
import { query } from '../db.js';
import { weeklyEmail } from './template.js';
import { sendEmail, siteUrl } from './send.js';

const WEEK = 7 * 86_400_000;
export const SECTIONS = ['price', 'feature', 'dead', 'rising'];

// One entry per link and kind, newest first: { kind, link: {id, title, url, siteName}, changes: [data, …] }.
export async function weekChanges(now = new Date()) {
  let rows;
  try {
    ({ rows } = await query(
      `SELECT h.link_id, h.kind, h.data, l.title, l.url, l.site_name, l.health
       FROM link_history h JOIN links l ON l.id = h.link_id
       WHERE h.kind = ANY($1) AND h.found_at > $2 AND h.found_at <= $3
       ORDER BY h.found_at DESC, h.id DESC`,
      [SECTIONS, new Date(now.getTime() - WEEK), now],
    ));
  } catch (err) {
    if (err.code === '42P01') return []; // no link_history table yet: nothing was watched
    throw err;
  }
  const entries = new Map();
  for (const row of rows) {
    // A link that broke and works again by now is not news any more.
    if (row.kind === 'dead' && row.health !== 'broken') continue;
    const key = `${row.kind}:${row.link_id}`;
    if (!entries.has(key)) {
      entries.set(key, {
        kind: row.kind,
        link: { id: row.link_id, title: row.title, url: row.url, siteName: row.site_name },
        changes: [],
      });
    }
    entries.get(key).changes.push(row.data ?? {});
  }
  return [...entries.values()];
}

// Builds the email and sends it. `test` adds a note at the top and its own subject, and never counts as the week's email.
export async function sendWeeklyEmail({ now = new Date(), test = false, key } = {}) {
  const entries = await weekChanges(now);
  const email = weeklyEmail({ entries, now, base: siteUrl(), test });
  const sent = await sendEmail({ ...email, key });
  return { ...sent, changes: entries.length };
}
