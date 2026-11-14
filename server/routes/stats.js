// The Stats page: your library in numbers, all in one answer. The biggest topics (the mosaic), where the companies
// behind your tools are (the world map), whether your links still open, how many are free, the days you added and
// opened links (the calendar), links you never opened, how old the companies are, and what changed this week
// (prices, features, dead links).
// One country's own numbers, for the panel that opens when you click a country on the globe (/stats/country/:code).
// Also the website facts the compare window shows for each link (popularity, app rating, trust, owner, price changes).
// The facts come from link_facts and link_history, which the facts robot fills in day by day: everything here works
// (and says so) while they are still empty.
import express from 'express';
import { requireReader } from '../auth.js';
import { query } from '../db.js';
import { COUNTRY_OF, UNKNOWN_COUNTRY } from '../links.js';

export const stats = express.Router();

const CALENDAR_DAYS = 372; // the calendar shows a year of weeks (53), plus a few days so no edge is missed
const CHANGE_KINDS = ['price', 'feature', 'dead', 'rising'];
const CHANGES_SHOWN = 40;
const BROKEN_SHOWN = 12;
const GEMS_SHOWN = 24; // "Forgotten gems": the page shows 4 at a time and "Show others" goes through these
const MOST_OPENED = 5;
const COMPANIES_SHOWN = 3; // the 3 oldest and the 3 newest companies
const PRICINGS = ['free', 'freemium', 'open-source', 'paid', 'unknown']; // the order of the "price mix" bar
const MAX_COMPARE = 4;
const COUNTRY_LINKS = 12; // the country panel shows the most popular few; its button opens all of them in the library
const COUNTRY_COMPANIES = 6;

const linkOf = row => ({ id: row.link_id ?? row.id, title: row.title, url: row.url, iconUrl: row.icon_url, category: row.category, source: row.source });

// The day of a moment as "2026-10-28", in the visitor's own time (their minutes ahead of UTC, from the browser):
// a link saved late at night in India belongs to that Indian day, not to the day in London.
const dayOf = column => `to_char((${column} AT TIME ZONE 'UTC') + make_interval(mins => $1), 'YYYY-MM-DD')`;

stats.get('/stats', requireReader, async (req, res) => {
  const offset = Math.max(-840, Math.min(840, Math.round(Number(req.query.offset)) || 0)); // minutes; ±14 hours at most
  // All at once: each trip to the database takes time (about 0.3 s to Neon), so they all go in parallel.
  const [totals, groups, days, picks, companies, changes, broken] = await Promise.all([
    // The headline numbers and the parts of the "health" ring. A link "may be broken" when its page didn't open (or
    // the robot couldn't read it at all); it "works" when the robot read it fine; the rest wait to be read.
    query(
      `SELECT count(*)::int AS links,
         count(*) FILTER (WHERE health = 'broken' OR status = 'failed')::int AS dead,
         count(*) FILTER (WHERE health <> 'broken' AND status = 'ready')::int AS working,
         count(*) FILTER (WHERE health <> 'broken' AND status NOT IN ('ready', 'failed'))::int AS unread,
         count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS this_week,
         count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS this_month,
         count(*) FILTER (WHERE opens > 0)::int AS opened,
         count(*) FILTER (WHERE opens = 0 AND status = 'ready' AND health <> 'broken')::int AS never_opened,
         max(created_at) AS last_added,
         max(checked_at) AS last_check,
         (SELECT count(*)::int FROM link_history WHERE kind = 'price' AND found_at >= date_trunc('month', now())) AS price_changes,
         (SELECT count(*)::int FROM link_facts) AS with_facts
       FROM links`,
    ),
    // Three ways to group the links, in one trip: by category, by price, and by the company's country.
    query(
      `SELECT 'category' AS facet, category AS value, count(*)::int AS count FROM links GROUP BY 2
       UNION ALL
       SELECT 'pricing', pricing, count(*)::int FROM links GROUP BY 2
       UNION ALL
       SELECT 'country', ${COUNTRY_OF('lf')}, count(*)::int FROM links JOIN link_facts AS lf ON lf.link_id = links.id
       GROUP BY 2 HAVING ${COUNTRY_OF('lf')} IS NOT NULL`,
    ),
    // The calendar: links added per day, and links last opened per day (a link remembers only the last time you
    // opened it), for the last year. Plus the day the most links ever came in: a big import fills one square.
    query(
      `SELECT 'added' AS kind, ${dayOf('created_at')} AS day, count(*)::int AS count
       FROM links WHERE created_at >= now() - interval '${CALENDAR_DAYS} days' GROUP BY 2
       UNION ALL
       SELECT 'opened', ${dayOf('opened_at')}, count(*)::int
       FROM links WHERE opened_at >= now() - interval '${CALENDAR_DAYS} days' GROUP BY 2
       UNION ALL
       (SELECT 'busiest', ${dayOf('created_at')}, count(*)::int FROM links GROUP BY 2 ORDER BY 3 DESC, 2 DESC LIMIT 1)`,
      [offset],
    ),
    // Links to rediscover: some you never opened (a different handful each day, the same all day long), and the
    // ones you open the most.
    query(
      `(SELECT 'gem' AS part, id, title, url, icon_url, category, source, opens, opened_at FROM links
        WHERE opens = 0 AND status = 'ready' AND health <> 'broken'
        ORDER BY md5(id || to_char(now(), 'YYYY-MM-DD')) LIMIT ${GEMS_SHOWN})
       UNION ALL
       (SELECT 'top', id, title, url, icon_url, category, source, opens, opened_at FROM links
        WHERE opens > 0 ORDER BY opens DESC, opened_at DESC NULLS LAST, id LIMIT ${MOST_OPENED})`,
    ),
    // Company ages: the year each company behind your links was founded (Wikidata). One row per company (its most
    // opened link stands for it), then the oldest few, the newest few, and how many were founded in each decade.
    query(
      `WITH founded AS (
         -- CASE first checks it is 4 digits, then turns it into a number: an odd value can never break the page.
         SELECT lf.facts #>> '{wikidata,id}' AS company,
           coalesce(nullif(lf.facts #>> '{wikidata,name}', ''), nullif(lf.facts #>> '{company,name}', ''), links.title) AS name,
           CASE WHEN lf.facts #>> '{wikidata,founded}' ~ '^[0-9]{4}$' THEN (lf.facts #>> '{wikidata,founded}')::int END AS year,
           links.id, links.title, links.url, links.icon_url, links.category, links.source, links.opens, links.created_at
         FROM link_facts AS lf JOIN links ON links.id = lf.link_id
         WHERE lf.facts #>> '{wikidata,founded}' IS NOT NULL
       ), companies AS (
         SELECT DISTINCT ON (coalesce(company, id)) name, year, id, title, url, icon_url, category, source
         FROM founded WHERE year BETWEEN 1000 AND extract(year FROM now())::int
         ORDER BY coalesce(company, id), opens DESC, created_at, id
       ), ranked AS (
         SELECT *, row_number() OVER (ORDER BY year, lower(name), id) AS oldest,
           row_number() OVER (ORDER BY year DESC, lower(name), id) AS newest
         FROM companies
       )
       SELECT 'oldest' AS part, name, year, id, title, url, icon_url, category, source, 1 AS count
       FROM ranked WHERE oldest <= ${COMPANIES_SHOWN}
       UNION ALL
       SELECT 'newest', name, year, id, title, url, icon_url, category, source, 1
       FROM ranked WHERE newest <= ${COMPANIES_SHOWN}
       UNION ALL
       SELECT 'decade', NULL, year / 10 * 10, NULL, NULL, NULL, NULL, NULL, NULL, count(*)::int
       FROM companies GROUP BY year / 10 * 10`,
    ),
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
  // The groups come back mixed and in no order: most links first, the same count by name.
  const group = facet =>
    groups.rows
      .filter(row => row.facet === facet)
      .map(({ value, count }) => ({ value, count }))
      .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
  // Only real two-letter codes ("US") make it to the map; anything else counts as not known.
  const known = group('country')
    .filter(row => /^[A-Z]{2}$/.test(row.value))
    .map(({ value, count }) => ({ country: value, count }));
  const placed = known.reduce((sum, row) => sum + row.count, 0);
  const categories = group('category');
  // Every price kind in the same order each time (an empty one counts 0), so the bar's colors never swap places.
  const pricingCounts = Object.fromEntries(group('pricing').map(row => [row.value, row.count]));
  const pricing = PRICINGS.map(value => ({ value, count: pricingCounts[value] ?? 0 }));
  pricing[PRICINGS.indexOf('unknown')].count += Object.entries(pricingCounts)
    .filter(([value]) => !PRICINGS.includes(value))
    .reduce((sum, [, count]) => sum + count, 0);

  const daysOf = kind => days.rows.filter(row => row.kind === kind).map(({ day, count }) => ({ day, count }));
  const pick = part => picks.rows.filter(row => row.part === part);
  const company = row => ({ name: row.name, year: row.year, link: linkOf(row) });
  const decades = companies.rows
    .filter(row => row.part === 'decade')
    .map(row => ({ decade: row.year, count: row.count }))
    .sort((a, b) => a.decade - b.decade);
  const newest = companies.rows.filter(row => row.part === 'newest').sort((a, b) => b.year - a.year || a.name.localeCompare(b.name));

  res.json({
    totals: {
      links: total.links,
      countries: known.length,
      categories: categories.length,
      priceChanges: total.price_changes,
      dead: total.dead,
      thisWeek: total.this_week,
      thisMonth: total.this_month,
      lastAdded: total.last_added,
      opened: total.opened,
      withFacts: total.with_facts,
      unknownCountry: Math.max(0, total.links - placed),
    },
    countries: known,
    categories,
    pricing,
    health: { working: total.working, broken: total.dead, unread: total.unread, lastCheck: total.last_check },
    activity: { added: daysOf('added'), opened: daysOf('opened'), busiestDay: daysOf('busiest')[0] ?? null, offset },
    gems: { total: total.never_opened, items: pick('gem').map(linkOf) },
    mostOpened: pick('top').map(row => ({ ...linkOf(row), opens: row.opens, openedAt: row.opened_at })),
    companies: {
      total: decades.reduce((sum, row) => sum + row.count, 0),
      oldest: companies.rows.filter(row => row.part === 'oldest').sort((a, b) => a.year - b.year || a.name.localeCompare(b.name)).map(company),
      newest: newest.map(company),
      decades,
    },
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

// Everything the country panel shows, in one quick answer: how many links, the place among countries, what they are
// about, what they cost, who is behind them, and the top links. `code` is a two-letter code ("IN"), or "unknown" for
// the links whose country isn't known yet. Two trips to the database, side by side (about 0.3 s each to Neon).
stats.get('/stats/country/:code', requireReader, async (req, res) => {
  const unknown = req.params.code === UNKNOWN_COUNTRY;
  const code = unknown ? UNKNOWN_COUNTRY : String(req.params.code).toUpperCase();
  if (!unknown && !/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'That is not a country.' });
  // A link with no facts at all has no country yet: LEFT JOIN keeps it, and it counts as not known.
  const here = `FROM links LEFT JOIN link_facts AS lf ON lf.link_id = links.id WHERE ${COUNTRY_OF('lf')} ${unknown ? 'IS NULL' : '= $1'}`;
  const params = unknown ? [] : [code];
  const [groups, top] = await Promise.all([
    query(
      `WITH here AS (
         SELECT links.category, links.pricing, links.opens, links.favorite,
           lf.facts #>> '{trust,grade}' AS grade,
           coalesce(nullif(lf.facts #>> '{wikidata,name}', ''), nullif(lf.facts #>> '{company,name}', '')) AS company
         ${here}
       )
       SELECT 'count' AS facet, NULL AS value, count(*)::int AS count FROM here
       UNION ALL SELECT 'opened', NULL, count(*)::int FROM here WHERE opens > 0
       UNION ALL SELECT 'favorites', NULL, count(*)::int FROM here WHERE favorite
       UNION ALL SELECT 'category', category, count(*)::int FROM here GROUP BY 2
       UNION ALL SELECT 'pricing', pricing, count(*)::int FROM here GROUP BY 2
       UNION ALL SELECT 'grade', grade, count(*)::int FROM here WHERE grade IS NOT NULL GROUP BY 2
       UNION ALL SELECT 'company', company, count(*)::int FROM here WHERE company IS NOT NULL GROUP BY 2
       UNION ALL SELECT 'library', NULL, count(*)::int FROM links
       UNION ALL SELECT 'country', ${COUNTRY_OF('lf')}, count(*)::int FROM links JOIN link_facts AS lf ON lf.link_id = links.id
         GROUP BY 2 HAVING ${COUNTRY_OF('lf')} IS NOT NULL`,
      params,
    ),
    // Most popular first: the same order as "Most popular" in the library, so the panel and the library agree.
    query(
      `SELECT links.id, links.title, links.url, links.icon_url, links.category, links.source ${here}
       ORDER BY (lf.facts #>> '{popularity,bucket}')::numeric ASC NULLS LAST, links.opens DESC, links.created_at DESC, links.id
       LIMIT ${COUNTRY_LINKS}`,
      params,
    ),
  ]);

  const facet = name =>
    groups.rows
      .filter(row => row.facet === name)
      .map(({ value, count }) => ({ value, count }))
      .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
  const number = name => facet(name)[0]?.count ?? 0;
  // The same order as the country list on the page, so "#2 of 36" here is the second row there.
  const countries = facet('country');
  const rank = unknown ? null : countries.findIndex(row => row.value === code) + 1 || null;
  // Every price kind in the same order each time, like the page's own price bar.
  const prices = Object.fromEntries(facet('pricing').map(row => [row.value, row.count]));
  const pricing = PRICINGS.map(value => ({ value, count: prices[value] ?? 0 }));
  pricing[PRICINGS.indexOf('unknown')].count += Object.entries(prices)
    .filter(([value]) => !PRICINGS.includes(value))
    .reduce((sum, [, count]) => sum + count, 0);
  const companies = facet('company');

  res.json({
    code,
    count: number('count'),
    library: number('library'),
    rank,
    countries: countries.length,
    categories: facet('category'),
    pricing,
    companies: companies.slice(0, COUNTRY_COMPANIES).map(({ value, count }) => ({ name: value, count })),
    companiesTotal: companies.length,
    trust: facet('grade').map(({ value, count }) => ({ grade: value, count })),
    opened: number('opened'),
    favorites: number('favorites'),
    links: top.rows.map(linkOf),
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
