// The Stats page: your library in numbers. Where the companies behind your tools are (for the world map), how many
// links you saved each month, the biggest categories, and what changed this week (prices, features, dead links).
// Also the website facts the compare window shows for each link (popularity, app rating, trust, owner, price changes).
// The facts come from link_facts and link_history, which the facts robot fills in day by day: everything here works
// (and says so) while they are still empty.
import express from 'express';
import { requireReader } from '../auth.js';
import { query } from '../db.js';
import { COUNTRY_OF } from '../links.js';

export const stats = express.Router();

const MONTHS_SHOWN = 12; // the chart always shows at least the last 12 months…
const MONTHS_MAX = 24; // …and at most 24, for a library that is older
const CHANGE_KINDS = ['price', 'feature', 'dead', 'rising'];
const CHANGES_SHOWN = 40;
const BROKEN_SHOWN = 12;
const MAX_COMPARE = 4;

const linkOf = row => ({ id: row.link_id ?? row.id, title: row.title, url: row.url, iconUrl: row.icon_url, category: row.category, source: row.source });

stats.get('/stats', requireReader, async (req, res) => {
  // All at once: each trip to the database takes time.
  const [totals, countries, months, busiest, categories, changes, broken] = await Promise.all([
    query(
      `SELECT count(*)::int AS links,
         count(*) FILTER (WHERE health = 'broken' OR status = 'failed')::int AS dead,
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS this_month,
         (SELECT count(*)::int FROM link_history WHERE kind = 'price' AND found_at >= date_trunc('month', now())) AS price_changes,
         (SELECT count(*)::int FROM link_facts) AS with_facts
       FROM links`,
    ),
    query(
      `SELECT ${COUNTRY_OF('lf')} AS country, count(*)::int AS count
       FROM links JOIN link_facts AS lf ON lf.link_id = links.id
       GROUP BY 1 HAVING ${COUNTRY_OF('lf')} IS NOT NULL ORDER BY 2 DESC, 1`,
    ),
    // Every month from the first link (but at least the last 12 and at most the last 24), empty months included.
    query(
      `SELECT to_char(m, 'YYYY-MM') AS month, count(links.id)::int AS count
       FROM generate_series(
         (SELECT least(greatest(date_trunc('month', min(created_at)), date_trunc('month', now()) - interval '${MONTHS_MAX - 1} months'),
                       date_trunc('month', now()) - interval '${MONTHS_SHOWN - 1} months') FROM links),
         date_trunc('month', now()), interval '1 month') AS m
       LEFT JOIN links ON links.created_at >= m AND links.created_at < m + interval '1 month'
       GROUP BY m ORDER BY m`,
    ),
    // The day the most links came in: a big import makes one tall bar, and the page says why.
    query(`SELECT to_char(created_at, 'YYYY-MM-DD') AS day, count(*)::int AS count FROM links GROUP BY 1 ORDER BY 2 DESC LIMIT 1`),
    query(`SELECT category AS value, count(*)::int AS count FROM links GROUP BY 1 ORDER BY 2 DESC, 1`),
    query(
      `SELECT h.id, h.kind, h.data, h.found_at, links.id AS link_id, links.title, links.url, links.icon_url, links.category, links.source,
         count(*) OVER ()::int AS total
       FROM link_history AS h JOIN links ON links.id = h.link_id
       WHERE h.kind = ANY($1) AND h.found_at >= now() - interval '7 days'
       ORDER BY h.found_at DESC, h.id DESC LIMIT $2`,
      [CHANGE_KINDS, CHANGES_SHOWN],
    ),
    query(
      `SELECT id, title, url, icon_url, category, source, checked_at, count(*) OVER ()::int AS total
       FROM links WHERE health = 'broken' ORDER BY checked_at DESC NULLS LAST, lower(title) LIMIT $1`,
      [BROKEN_SHOWN],
    ),
  ]);

  const total = totals.rows[0];
  // Only real two-letter codes ("US") make it to the map; anything else counts as not known.
  const known = countries.rows.filter(row => /^[A-Z]{2}$/.test(row.country));
  const placed = known.reduce((sum, row) => sum + row.count, 0);
  res.json({
    totals: {
      links: total.links,
      countries: known.length,
      priceChanges: total.price_changes,
      dead: total.dead,
      thisMonth: total.this_month,
      withFacts: total.with_facts,
      unknownCountry: Math.max(0, total.links - placed),
    },
    countries: known,
    months: months.rows,
    busiestDay: busiest.rows[0] ?? null,
    categories: categories.rows,
    changes: {
      total: changes.rows[0]?.total ?? 0,
      items: changes.rows.map(row => ({ id: String(row.id), kind: row.kind, data: row.data, foundAt: row.found_at, link: linkOf(row) })),
    },
    broken: {
      total: broken.rows[0]?.total ?? 0,
      items: broken.rows.map(row => ({ ...linkOf(row), checkedAt: row.checked_at })),
    },
  });
});

// The website facts of 2 to 4 links, for the compare window's rows: { items: { [id]: { facts, priceChanges, lastPrice } } }.
stats.get('/compare/facts', requireReader, async (req, res) => {
  const ids = [...new Set(String(req.query.ids ?? '').split(',').filter(Boolean))].slice(0, MAX_COMPARE);
  if (!ids.length) return res.json({ items: {} });
  const { rows } = await query(
    `SELECT wanted.id, coalesce(lf.facts, '{}') AS facts,
       (SELECT count(*)::int FROM link_history AS h WHERE h.link_id = wanted.id AND h.kind = 'price') AS price_changes,
       (SELECT jsonb_build_object('data', h.data, 'foundAt', h.found_at) FROM link_history AS h
         WHERE h.link_id = wanted.id AND h.kind = 'price' ORDER BY h.found_at DESC LIMIT 1) AS last_price
     FROM unnest($1::text[]) AS wanted(id) LEFT JOIN link_facts AS lf ON lf.link_id = wanted.id`,
    [ids],
  );
  res.json({
    items: Object.fromEntries(rows.map(row => [row.id, { facts: row.facts, priceChanges: row.price_changes, lastPrice: row.last_price }])),
  });
});
