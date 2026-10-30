// Everything that reads or writes links in the database.
import crypto from 'node:crypto';
import { query, getMeta, setMeta } from './db.js';
import { settings } from './config.js';
import { cleanUrl, urlKey, prettyUrl, sourceOf, repairUrl } from './robot/url.js';
import { normalizeTags, tagKey } from './robot/describe.js';
import { searchWords, isWeak } from './words.js';

const MIN_MEANING = 0.35; // below this, a link is not about what was asked
const STRONG_MEANING = 0.45; // from here on, the meaning alone makes a link a "best match"
const WORDS_NEED_MEANING = 0.2; // your words alone aren't enough when the link is about something else
const BEST_WORDS = 0.6; // a best match has at least this share of the search's weight in its important places…
const RELATED_WORDS = 0.5; // …and a related link at least this much
const BEST_MAX = 12; // the strongest 12 are best matches; more would just be a long list again
const COMMON_SHARE = 0.35; // a word in more than 35% of the links ("ai", "free") can't make a best match alone
export const LEVELS = ['beginner', 'intermediate', 'advanced'];
export const MY_STATUSES = ['to-try', 'using', 'done'];

// What lists and cards need. The detail view also gets DETAIL_FIELDS. The saved page text (content) is only
// used for search and is never sent to the website: it's big.
const FIELDS = `id, url, title, description, summary, use_for, features, category, tags, user_tags, pricing, source,
  site_name, author, image_url, icon_url, github, note, collection, status, ai_status, error, health,
  created_at, updated_at, tasks, level, favorite, my_status, opens, opened_at`;
const DETAIL_FIELDS = `${FIELDS}, overview, audience, quick_start, search_words, headings, page_links, pages_read`;
// The small "Price went up" tag on boxes: the last time a plan's price rose, within 30 days (server/facts/kinds/prices.js).
// Lists and search results ask for it; jsonb compares the two numbers, so an odd row can never break the list.
const PRICE_UP = `(SELECT max(h.found_at) FROM link_history h WHERE h.link_id = links.id AND h.kind = 'price'
  AND h.found_at > now() - interval '30 days' AND (h.data -> 'to') > (h.data -> 'from')) AS price_up_at`;
const prefixed = (fields, table) => fields.replace(/(^|,\s*)(\w+)/g, `$1${table}.$2`);

// Database row → what the website receives.
export function toLink(row) {
  const link = {
    id: row.id,
    url: row.url,
    title: row.title,
    description: row.description,
    summary: row.summary,
    useFor: row.use_for,
    features: row.features ?? [],
    category: row.category,
    tags: row.tags ?? [],
    userTags: row.user_tags ?? [],
    pricing: row.pricing,
    source: row.source,
    siteName: row.site_name,
    author: row.author,
    imageUrl: row.image_url,
    iconUrl: row.icon_url,
    github: row.github,
    note: row.note,
    collection: row.collection,
    status: row.status,
    aiStatus: row.ai_status,
    error: row.error,
    health: row.health,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks: row.tasks ?? [],
    level: row.level ?? '',
    favorite: Boolean(row.favorite),
    myStatus: row.my_status ?? '',
    opens: row.opens ?? 0,
    openedAt: row.opened_at ?? null,
  };
  if ('overview' in row) {
    Object.assign(link, {
      overview: row.overview,
      audience: row.audience,
      quickStart: row.quick_start ?? [],
      searchWords: row.search_words ?? [],
      headings: row.headings ?? [],
      pageLinks: row.page_links ?? [],
      pagesRead: row.pages_read ?? [],
    });
  }
  if (row.price_up_at) link.priceUpAt = row.price_up_at;
  if ('best' in row) link.match = row.best ? 'best' : 'related';
  if (row.snippet) link.snippet = row.snippet;
  return link;
}

// ---------- Filters ----------

// Builds the WHERE part for the filters chosen on the website. `skip` leaves one filter out (for counts).
function filterSql(filters, params, skip = '') {
  const clauses = [];
  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (filters.category && skip !== 'category') add('category = ?', filters.category);
  if (filters.source && skip !== 'source') add('source = ?', filters.source);
  if (filters.collection && skip !== 'collection') add('collection = ?', filters.collection);
  if (filters.tag && skip !== 'tag') add('EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE lower(tag) = lower(?))', filters.tag);
  if (filters.level && skip !== 'level') add('level = ?', filters.level);
  if (filters.status && skip !== 'status') add('my_status = ?', filters.status);
  if (filters.favorite && skip !== 'favorite') clauses.push('favorite');
  if (filters.free && skip !== 'free') clauses.push(`pricing IN ('free', 'open-source', 'freemium')`);
  // Pages that seem to be gone, or that the robot couldn't read: the ones to fix or delete.
  if (filters.broken && skip !== 'broken') clauses.push(`(health = 'broken' OR status = 'failed')`);
  // Facts the robot found about the website (link_facts): where the company is, and its trust grade.
  if (filters.country === UNKNOWN_COUNTRY && skip !== 'country') {
    clauses.push(`id NOT IN (SELECT link_id FROM link_facts WHERE ${COUNTRY_OF('link_facts')} IS NOT NULL)`);
  } else if (filters.country && skip !== 'country') {
    add(`id IN (SELECT link_id FROM link_facts WHERE ${COUNTRY_OF('link_facts')} = ?)`, filters.country);
  }
  if (filters.trust && skip !== 'trust') clauses.push(`id IN (SELECT link_id FROM link_facts WHERE facts #>> '{trust,grade}' IN ('A', 'B'))`);
  if (filters.ids) add('id = ANY(?)', filters.ids);
  return clauses;
}

// The country of a link, as a two-letter code ("US"), one answer for the filter, its counts and the Stats page:
// the `place` fact (server/facts/kinds/place.js) once it's worked out, before that the company's Terms page or
// Wikidata. Anything that isn't two capital letters counts as not known. (No "?" in here: filterSql's add() would
// take it for the value's place.)
export const COUNTRY_OF = table =>
  `substring(upper(CASE WHEN ${table}.facts -> 'place' IS NOT NULL THEN ${table}.facts #>> '{place,country}'
    ELSE coalesce(nullif(${table}.facts #>> '{company,country}', ''), nullif(${table}.facts #>> '{wikidata,country}', '')) END)
    from '^[A-Z]{2}$')`;
export const UNKNOWN_COUNTRY = 'unknown'; // the country filter's value for links whose country isn't known (yet)

const whereOf = clauses => (clauses.length ? `WHERE ${clauses.join(' AND ')}` : '');

const encodeCursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function decodeCursor(cursor) {
  try {
    return cursor ? JSON.parse(Buffer.from(cursor, 'base64url').toString()) : null;
  } catch {
    return null;
  }
}

// ---------- Browsing: 24 at a time, the next page continues where the last one stopped ----------

const OFFSET_SORTS = {
  stars: `(github ->> 'stars')::int DESC NULLS LAST, id`,
  title: 'lower(title), id',
  used: 'opens DESC, opened_at DESC NULLS LAST, id',
  opened: 'opened_at DESC NULLS LAST, created_at DESC, id',
  favorites: 'favorite DESC, created_at DESC, id',
};
// Orders that use the facts about each website, so link_facts is joined in (as `lf`). Links without the fact go last.
// - Most popular: the smallest popularity bucket first ("top 1,000 websites" before "top 10,000").
// - Best rated: the app's rating, pulled towards 4 when only a few people rated it (a "4.0 from 20 votes" head
//   start), so a 5.0 from 3 people doesn't beat a 4.8 from 100,000.
const FACT_SORTS = {
  popular: `(lf.facts #>> '{popularity,bucket}')::numeric ASC NULLS LAST, links.opens DESC, links.created_at DESC, links.id`,
  rated: `((lf.facts #>> '{app,ios,rating}')::numeric * coalesce((lf.facts #>> '{app,ios,ratings}')::numeric, 1) + 80)
      / (coalesce((lf.facts #>> '{app,ios,ratings}')::numeric, 1) + 20) DESC NULLS LAST, links.opens DESC, links.created_at DESC, links.id`,
};
export const SORTS = ['newest', 'oldest', ...Object.keys(OFFSET_SORTS), ...Object.keys(FACT_SORTS)];

export async function listLinks({ filters = {}, sort = 'newest', limit = settings.pageSize, cursor } = {}) {
  const params = [];
  const clauses = filterSql(filters, params);
  const after = decodeCursor(cursor);
  let order;
  let offset = 0;
  let from = 'links';
  let fields = FIELDS;

  if (FACT_SORTS[sort]) {
    order = FACT_SORTS[sort];
    offset = after?.offset ?? 0;
    from = 'links LEFT JOIN link_facts AS lf ON lf.link_id = links.id';
    fields = prefixed(FIELDS, 'links');
  } else if (OFFSET_SORTS[sort]) {
    order = OFFSET_SORTS[sort];
    offset = after?.offset ?? 0;
  } else {
    order = sort === 'oldest' ? 'created_at ASC, id ASC' : 'created_at DESC, id DESC';
    // "Keyset" paging: continue right after the last link of the previous page. Fast even with 100,000 links.
    if (after?.t) {
      params.push(after.t, after.id);
      const compare = sort === 'oldest' ? '>' : '<';
      clauses.push(`(created_at, id) ${compare} ($${params.length - 1}::timestamptz, $${params.length})`);
    }
  }

  params.push(limit + 1, offset);
  const { rows } = await query(
    `SELECT ${fields}, ${PRICE_UP} FROM ${from} ${whereOf(clauses)} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  const items = rows.slice(0, limit).map(toLink);
  let nextCursor = null;
  if (rows.length > limit) {
    const last = rows[limit - 1];
    const paged = OFFSET_SORTS[sort] || FACT_SORTS[sort];
    nextCursor = encodeCursor(paged ? { offset: offset + limit } : { t: new Date(last.created_at).toISOString(), id: last.id });
  }
  return { items, nextCursor };
}

export async function countLinks(filters = {}) {
  const params = [];
  const { rows } = await query(`SELECT count(*)::int AS n FROM links ${whereOf(filterSql(filters, params))}`, params);
  return rows[0].n;
}

// ---------- Every link in a view, for Select mode's "Select all" ----------

// The most links one "Select all" (and one change to many links) takes at once. A bigger view gets its first
// MAX_BULK links, in the list's order, and is told so: one click never changes the whole library by surprise.
export const MAX_BULK = 2000;

// The ids of every link the list shows for these filters, in the same order, not only the 24 loaded so far.
// `capped` says the view has more than MAX_BULK links.
export async function listIds({ filters = {}, sort = 'newest' } = {}) {
  const params = [];
  const clauses = filterSql(filters, params);
  let order = OFFSET_SORTS[sort] ?? (sort === 'oldest' ? 'created_at ASC, id ASC' : 'created_at DESC, id DESC');
  let from = 'links';
  if (FACT_SORTS[sort]) {
    order = FACT_SORTS[sort];
    from = 'links LEFT JOIN link_facts AS lf ON lf.link_id = links.id';
  }
  params.push(MAX_BULK + 1); // one more than the most, to know whether there are more
  const { rows } = await query(`SELECT links.id FROM ${from} ${whereOf(clauses)} ORDER BY ${order} LIMIT $${params.length}`, params);
  return { ids: rows.slice(0, MAX_BULK).map(row => row.id), capped: rows.length > MAX_BULK, max: MAX_BULK };
}

// The same for a search: every result, best matches first, as the list shows them.
export async function searchIds({ q, vector, filters = {} }) {
  const params = [];
  const cte = await searchCte(q, vector, filters, params);
  if (!cte) return { ids: [], capped: false, max: MAX_BULK };
  params.push(MAX_BULK + 1);
  const { rows } = await query(
    `${cte.with}
     SELECT links.id FROM found JOIN links ON links.id = found.id
     ORDER BY found.best DESC, found.score DESC, links.created_at DESC LIMIT $${params.length}`,
    params,
  );
  return { ids: rows.slice(0, MAX_BULK).map(row => row.id), capped: rows.length > MAX_BULK, max: MAX_BULK };
}

// ---------- Smart search: words + meaning, best matches first, then the related ones ----------

// Words of 4 letters or more also find longer words while you type ("ollam" finds "ollama", "edit" finds "editor").
// Short words must match exactly, so "ai" doesn't find "air".
const term = word => (word.length >= 4 ? `${word}:*` : word);
// The same, but only in the important places: name and tasks (A), tags, search words and headings (B), summaries (C).
// Not the page text (D), where almost every word shows up somewhere.
const strongTerm = word => (word.length >= 4 ? `${word}:*ABC` : `${word}:ABC`);

// Marks around your words in the "why it matched" line. The website turns them into bold text.
const HEADLINE = 'MaxWords=26, MinWords=12, ShortWord=2, MaxFragments=1, StartSel="", StopSel=""';

// How much each word of a search counts. A word that's in most of your links ("ai" is in 9 of 10) says little about
// what you want, so it counts little; a rare one ("logo", "pdf") counts a lot. Filler words ("website") count half.
// `common` words can't make a link a best match on their own.
// The counts come in one trip to the database and are kept for a minute: they barely change while you search.
const KEEP_COUNTS = 60_000;
let wordCounts = { at: 0, total: null, counts: new Map() };
async function wordWeights(words) {
  if (Date.now() - wordCounts.at > KEEP_COUNTS) wordCounts = { at: Date.now(), total: null, counts: new Map() };
  const kept = wordCounts;
  const missing = words.filter(word => !kept.counts.has(word));
  if (missing.length || kept.total === null) {
    const columns = missing.map((_, i) => `, count(*) FILTER (WHERE search @@ to_tsquery('english', $${i + 1}))::int AS w${i}`);
    const { rows } = await query(`SELECT count(*)::int AS total${columns.join('')} FROM links`, missing.map(strongTerm));
    kept.total = rows[0].total;
    missing.forEach((word, i) => kept.counts.set(word, rows[0][`w${i}`]));
  }
  const { total, counts } = kept;
  return words.map(word => ({
    word,
    common: total >= 20 && counts.get(word) / total > COMMON_SHARE,
    weight: Math.max(Math.log((total + 1) / (counts.get(word) + 1)), 0.05) * (isWeak(word) ? 0.5 : 1),
  }));
}

// Every link that matches the search, with:
//   best:  the words that matter are in its name, tasks, tags, search words or headings (and it's about the same thing),
//          or its meaning is very close. Only the strongest BEST_MAX are best matches; the rest are "also related".
//   score: how well it matches; higher comes first
async function searchCte(q, vector, filters, params) {
  const words = searchWords(q);
  if (!vector && !words.length) return null;
  const add = value => {
    params.push(value);
    return `$${params.length}`;
  };
  const parts = [];
  const sources = [];
  let similarity = '0';
  if (vector) {
    const v = `${add(vector)}::vector`;
    // The 300 closest in the whole library, and then the filters: a filter only ever narrows the results. So the list
    // says the same number as the filters' counts (facets(), which asks without the filters and counts them after).
    const chosen = filterSql(filters, params);
    parts.push(`meaning AS (
      SELECT id, similarity FROM (
        SELECT id, 1 - (embedding <=> ${v}) AS similarity FROM links WHERE embedding IS NOT NULL ORDER BY embedding <=> ${v} LIMIT 300
      ) AS nearest
      ${chosen.length ? `WHERE id IN (SELECT id FROM links ${whereOf(chosen)})` : ''}
    )`);
    sources.push('SELECT id FROM meaning');
    similarity = 'COALESCE(meaning.similarity, 0)';
  }

  // The words that say what you want: not the ones in most of your links. When every word is that common
  // (a search for "ai"), only the meaning decides, unless there's no meaning fingerprint to use.
  const weights = words.length ? await wordWeights(words) : [];
  const key = weights.filter(weight => !weight.common).map(weight => weight.word);
  const useWords = key.length ? key : vector ? [] : words;
  let wordColumns = '0 AS matched, 0 AS in_title, 0 AS word_rank, false AS key_found';
  if (useWords.length) {
    const any = `to_tsquery('english', ${add(useWords.map(term).join(' | '))})`;
    const all = `to_tsquery('english', ${add(useWords.map(term).join(' & '))})`;
    const clauses = [`search @@ ${any}`, ...filterSql(filters, params)];
    parts.push(`words AS (SELECT id FROM links ${whereOf(clauses)})`);
    sources.push('SELECT id FROM words');
    // How much of the search's weight is in the important places, and in the name: 0 = none of it, 1 = all of it.
    const sum = weights.reduce((total, weight) => total + weight.weight, 0);
    const share = (where, toQuery) =>
      weights.map(({ word, weight }) => `${(weight / sum).toFixed(4)} * (${where} @@ to_tsquery('english', ${add(toQuery(word))}))::int`).join(' + ');
    wordColumns = `${share('links.search', strongTerm)} AS matched, ${share(`to_tsvector('english', links.title)`, term)} AS in_title,
      COALESCE(ts_rank(links.search, ${any}, 32), 0) AS word_rank, links.search @@ ${all} AS key_found`;
  }
  const byWords = useWords.length > 0;
  const meaningToo = vector ? ` AND similarity >= ${WORDS_NEED_MEANING}` : '';

  const exact = add(q.trim().toLowerCase());
  parts.push(`candidates AS (
    SELECT links.id, ${similarity} AS similarity, ${wordColumns}, lower(links.title) = ${exact} AS exact_title, links.favorite, links.opens
    FROM (${sources.join(' UNION ')}) AS ids
    JOIN links ON links.id = ids.id
    ${vector ? 'LEFT JOIN meaning ON meaning.id = links.id' : ''}
  )`);
  parts.push(`matches AS (
    SELECT id,
      (${byWords} AND matched >= ${BEST_WORDS}${meaningToo}) OR similarity >= ${STRONG_MEANING} OR exact_title AS qualifies,
      similarity + 0.6 * word_rank + 0.35 * matched + 0.3 * in_title + CASE WHEN exact_title THEN 0.5 ELSE 0 END
        -- a small push for your favorites and the links you open most
        + CASE WHEN favorite THEN 0.03 ELSE 0 END + 0.03 * least(opens, 20) / 20.0 AS score
    FROM candidates
    WHERE similarity >= ${MIN_MEANING} OR exact_title
      OR (${byWords} AND (matched >= ${RELATED_WORDS} OR (key_found${meaningToo})))
  )`);
  parts.push(`found AS (
    SELECT id, score, qualifies AND row_number() OVER (ORDER BY qualifies DESC, score DESC) <= ${BEST_MAX} AS best FROM matches
  )`);
  // `words` are the ones shown in bold in the "why it matched" line.
  return { with: `WITH ${parts.join(',\n')}`, words: key.length ? key : words };
}

export async function searchLinks({ q, vector, filters = {}, limit = settings.pageSize, cursor }) {
  const offset = decodeCursor(cursor)?.offset ?? 0;
  const params = [];
  const cte = await searchCte(q, vector, filters, params);
  let rows = [];
  if (cte) {
    const any = cte.words.length ? `to_tsquery('english', $${params.push(cte.words.map(term).join(' | '))})` : null;
    params.push(limit + 1, offset);
    ({ rows } = await query(
      `${cte.with}
       SELECT page.*${any ? `, ts_headline('english', array_to_string(page.tasks, '. ') || '. ' || page.summary || ' ' || left(more.content, 10000), ${any}, '${HEADLINE}') AS snippet` : ''}
       FROM (
         SELECT ${prefixed(FIELDS, 'links')}, ${PRICE_UP}, found.best, found.score, count(*) OVER () AS total, count(*) FILTER (WHERE found.best) OVER () AS best_total
         FROM found JOIN links ON links.id = found.id
         ORDER BY found.best DESC, found.score DESC, links.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}
       ) AS page
       JOIN links AS more ON more.id = page.id
       ORDER BY page.best DESC, page.score DESC, page.created_at DESC`,
      params,
    ));
  }
  if (!rows.length && !offset && vector) {
    // Nothing really matches: show the 3 closest links, marked as such.
    const closeParams = [vector];
    const clauses = ['embedding IS NOT NULL', ...filterSql(filters, closeParams)];
    const { rows: closest } = await query(
      `SELECT ${FIELDS} FROM links ${whereOf(clauses)} ORDER BY embedding <=> $1::vector LIMIT 3`,
      closeParams,
    );
    return { items: closest.map(toLink), nextCursor: null, total: 0, bestTotal: 0, closestOnly: true };
  }
  return {
    items: rows.slice(0, limit).map(row => {
      const link = toLink(row);
      // A line without your words in it says nothing about why it matched: the card shows the summary instead.
      if (link.snippet && !link.snippet.includes('')) delete link.snippet;
      return link;
    }),
    nextCursor: rows.length > limit ? encodeCursor({ offset: offset + limit }) : null,
    total: Number(rows[0]?.total ?? 0),
    bestTotal: Number(rows[0]?.best_total ?? 0),
    closestOnly: false,
  };
}

// ---------- Suggestions while you type ----------

// Links whose name has a word starting with each word you typed ("video ed" → "Video Editor"), and tags that do.
// Names that start with your text come first, then the ones you open most.
export async function suggest(text) {
  const words = (String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 5);
  if (!words.length) return { links: [], tags: [] };
  const wordStarts = words.map(word => `\\m${word}`); // \m = where a word begins
  const start = `${words.join(' ')}%`;
  const [links, tags] = await Promise.all([
    query(
      `SELECT id, title, url, icon_url, category, source FROM links WHERE title ~* ALL($1)
       ORDER BY lower(title) LIKE $2 DESC, opens DESC, length(title) LIMIT 5`,
      [wordStarts, start],
    ),
    query(
      `SELECT tag AS value, count(*)::int AS count FROM links, unnest(tags) AS tag WHERE tag ~* ALL($1)
       GROUP BY tag ORDER BY lower(tag) LIKE $2 DESC, count(*) DESC LIMIT 3`,
      [wordStarts, start],
    ),
  ]);
  return {
    links: links.rows.map(row => ({ id: row.id, title: row.title, url: row.url, iconUrl: row.icon_url, category: row.category, source: row.source })),
    tags: tags.rows,
  };
}

// ---------- Counts for the filter chips ----------

// [name in the answer, column, the filter it leaves out]: a group's own filter doesn't narrow its counts.
const FACET_GROUPS = [
  ['categories', 'category', 'category'],
  ['sources', 'source', 'source'],
  ['collections', 'collection', 'collection'],
  ['levels', 'level', 'level'],
  ['statuses', 'my_status', 'status'],
];

// All the counts come from one question to the database: every trip there takes time.
// With a search, only its results count.
export async function facets({ q, vector, filters = {} }) {
  const params = [];
  const cte = q ? await searchCte(q, vector, {}, params) : null;
  const inSearch = q ? [cte ? 'links.id IN (SELECT id FROM found)' : 'false'] : [];
  const where = (chosen, skip) => whereOf([...inSearch, ...filterSql(chosen, params, skip)]);
  const parts = [
    ...FACET_GROUPS.map(
      ([name, column, skip]) =>
        `SELECT '${name}' AS facet, ${column} AS value, count(*)::int AS count FROM links ${where(filters, skip)}
         GROUP BY ${column} HAVING ${column} <> ''`,
    ),
    `(SELECT 'tags', tag, count(*)::int FROM links, unnest(tags) AS tag ${where(filters, 'tag')} GROUP BY 2 ORDER BY 3 DESC, 2 LIMIT 40)`,
    `SELECT 'free', '', count(*)::int FROM links ${where({ ...filters, free: true })}`,
    `SELECT 'favorites', '', count(*)::int FROM links ${where({ ...filters, favorite: true })}`,
    `SELECT 'broken', '', count(*)::int FROM links ${where({ ...filters, broken: true })}`,
    `SELECT 'total', '', count(*)::int FROM links ${where(filters)}`,
    // From the facts about each website: the company's country, and how many have trust grade A or B.
    `SELECT 'countries', ${COUNTRY_OF('lf')}, count(*)::int FROM links JOIN link_facts AS lf ON lf.link_id = links.id
     ${where(filters, 'country')} GROUP BY 2 HAVING ${COUNTRY_OF('lf')} IS NOT NULL`,
    `SELECT 'trusted', '', count(*)::int FROM links ${where({ ...filters, trust: true })}`,
  ];
  const { rows } = await query(`${cte ? cte.with : ''}\n${parts.join('\nUNION ALL\n')}`, params);

  const result = {
    categories: [], sources: [], collections: [], levels: [], statuses: [], tags: [], countries: [],
    free: 0, favorites: 0, broken: 0, trusted: 0, total: 0,
  };
  for (const { facet, value, count } of rows) {
    if (Array.isArray(result[facet])) result[facet].push({ value, count });
    else result[facet] = count;
  }
  // Most links first (the answer comes in no order); the same count by name.
  for (const name of [...FACET_GROUPS.map(([name]) => name), 'tags', 'countries']) {
    result[name].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }
  return result;
}

// ---------- Quick access ----------

// The links you come back to, for the row at the top of the home page:
// your favorites, the ones you opened last, and your "To try" list.
export async function shortcuts(limit = 12) {
  const pick = async (where, order) => {
    const { rows } = await query(
      `SELECT ${FIELDS}, count(*) OVER () AS total FROM links WHERE ${where} ORDER BY ${order} LIMIT $1`,
      [limit],
    );
    return { items: rows.map(toLink), total: Number(rows[0]?.total ?? 0) };
  };
  const [favorites, recent, toTry] = await Promise.all([
    pick('favorite', 'opened_at DESC NULLS LAST, created_at DESC'),
    pick('opened_at IS NOT NULL', 'opened_at DESC'),
    pick(`my_status = 'to-try'`, 'created_at DESC'),
  ]);
  return { favorites, recent, toTry };
}

// ---------- One link ----------

// With a search, `snippet` shows where its words appear in the website's text.
export async function getLink(id, q = '') {
  const words = q ? searchWords(q) : [];
  const params = [id];
  let snippet = '';
  if (words.length) {
    params.push(words.map(term).join(' | '));
    snippet = `, ts_headline('english', left(content, 20000), to_tsquery('english', $2), '${HEADLINE}') AS snippet`;
  }
  const { rows } = await query(`SELECT ${DETAIL_FIELDS}${snippet} FROM links WHERE id = $1`, params);
  if (!rows[0]) return null;
  const link = toLink(rows[0]);
  if (link.snippet && !link.snippet.includes('')) delete link.snippet;
  return link;
}

export async function getLinks(ids) {
  const { rows } = await query(`SELECT ${FIELDS} FROM links WHERE id = ANY($1)`, [ids]);
  return rows.map(toLink);
}

// Other links in your library that do the same job.
export async function similarLinks(id, limit = 4) {
  const { rows } = await query(
    `SELECT ${prefixed(FIELDS, 'other')}
     FROM links target JOIN links other ON other.id <> target.id AND other.embedding IS NOT NULL
     WHERE target.id = $1 AND target.embedding IS NOT NULL AND 1 - (other.embedding <=> target.embedding) >= ${MIN_MEANING}
     ORDER BY other.embedding <=> target.embedding LIMIT $2`,
    [id, limit],
  );
  return rows.map(toLink);
}

// ---------- Tags ----------

// The tags the library uses, most used first. The robot gives these to the AI, so tags stay the same everywhere.
export async function knownTags(limit = 150) {
  const { rows } = await query(
    `SELECT tag, count(*) AS n FROM links, unnest(tags) AS tag GROUP BY tag ORDER BY n DESC, tag LIMIT $1`,
    [limit],
  );
  return rows.map(row => row.tag);
}

// Renames a tag on every link. Renaming it to a tag that already exists merges the two.
export async function renameTag(from, to) {
  const target = normalizeTags([to], await knownTags())[0];
  if (!target) return 0;
  const fromKey = tagKey(from);
  const { rows } = await query(
    `SELECT id, tags, user_tags FROM links WHERE EXISTS (SELECT 1 FROM unnest(tags) AS tag WHERE lower(tag) = lower($1))`,
    [from],
  );
  const swap = tags => normalizeTags(tags.map(tag => (tagKey(tag) === fromKey ? target : tag)));
  for (const row of rows) {
    await query('UPDATE links SET tags = $2, user_tags = $3, updated_at = now() WHERE id = $1', [row.id, swap(row.tags), swap(row.user_tags)]);
  }
  return rows.length;
}

// Once, for libraries made before tidy tags: "local-ai" becomes "Local AI".
export async function tidyOldTags() {
  if (await getMeta('tags_tidied')) return;
  const { rows } = await query('SELECT id, tags, user_tags FROM links');
  for (const row of rows) {
    const tags = normalizeTags(row.tags);
    const userTags = normalizeTags(row.user_tags);
    if (tags.join('|') !== row.tags.join('|') || userTags.join('|') !== row.user_tags.join('|')) {
      await query('UPDATE links SET tags = $2, user_tags = $3 WHERE id = $1', [row.id, tags, userTags]);
    }
  }
  await setMeta('tags_tidied', Date.now());
}

// ---------- Repairs ----------

// Once, for links imported before the CSV fix: "https://klap.app/,AI" becomes "https://klap.app/" and is read again.
// When the repaired address is already in the library, the two become one link that keeps both links' tags,
// notes, star and opens.
export async function repairOldUrls() {
  if (await getMeta('urls_repaired')) return;
  const { rows } = await query(
    `SELECT id, url, title, tags, user_tags, note, collection, favorite, my_status, opens, opened_at
     FROM links WHERE url LIKE '%,%' OR url ~ '.https?://' ORDER BY created_at`,
  );
  let fixed = 0;
  let merged = 0;
  for (const row of rows) {
    const url = cleanUrl(repairUrl(row.url));
    const key = urlKey(url);
    if (!key || url === row.url) continue;
    const { rows: same } = await query(
      'SELECT id, tags, user_tags, note, collection, favorite, my_status, opens, opened_at FROM links WHERE url_key = $1 AND id <> $2',
      [key, row.id],
    );
    const keep = same[0];
    if (keep) {
      const notes = [...new Set([keep.note, row.note].filter(Boolean))].join('\n');
      await query(
        `UPDATE links SET tags = $2, user_tags = $3, note = $4, collection = $5, favorite = $6, my_status = $7,
           opens = $8, opened_at = $9 WHERE id = $1`,
        [
          keep.id,
          normalizeTags([...keep.tags, ...row.tags]),
          normalizeTags([...keep.user_tags, ...row.user_tags]),
          notes.slice(0, 1000),
          keep.collection || row.collection,
          keep.favorite || row.favorite,
          keep.my_status || row.my_status,
          keep.opens + row.opens,
          [keep.opened_at, row.opened_at].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] ?? null,
        ],
      );
      await query('DELETE FROM links WHERE id = $1', [row.id]);
      merged++;
    } else {
      // A name made from the broken address is replaced too; a name you typed stays until the robot reads the page.
      await query(
        `UPDATE links SET url = $2, url_key = $3, source = $4, title = $5, status = 'queued', ai_status = 'pending',
           attempts = 0, error = '', health = 'ok', updated_at = now() WHERE id = $1`,
        [row.id, url, key, sourceOf(url), row.title === prettyUrl(row.url) ? prettyUrl(url) : row.title],
      );
      fixed++;
    }
  }
  if (fixed || merged) console.log(`Repaired ${fixed} broken addresses and merged ${merged} copies.`);
  await setMeta('urls_repaired', Date.now());
}

// ---------- Adding ----------

// Adds new links as "queued" (the robot fills them in) and reports duplicates and bad links.
// `entries` are addresses, or { url, tags } when each link brings its own tags (like its bookmarks folder).
export async function addLinks(entries, { tags = [], collection = '', note = '' } = {}) {
  const result = { added: [], duplicates: [], invalid: [] };
  const fresh = new Map(); // key → { url, tags }, in the order they were given
  for (const entry of entries) {
    const raw = typeof entry === 'string' ? entry : entry?.url;
    const key = urlKey(raw);
    if (!key) result.invalid.push(String(raw));
    else if (!fresh.has(key)) fresh.set(key, { url: cleanUrl(raw), tags: Array.isArray(entry?.tags) ? entry.tags.slice(0, 8) : [] });
  }
  if (!fresh.size) return result;

  const keys = [...fresh.keys()];
  const { rows: existing } = await query(`SELECT ${FIELDS}, url_key FROM links WHERE url_key = ANY($1)`, [keys]);
  result.duplicates = existing.map(toLink);
  const taken = new Set(existing.map(row => row.url_key));
  const newKeys = keys.filter(key => !taken.has(key));
  if (!newKeys.length) return result;

  const known = await knownTags();
  // The first link in the list gets the newest time, so the list shows them in the order you pasted.
  const rows = newKeys.map((key, i) => {
    const { url, tags: own } = fresh.get(key);
    return {
      id: crypto.randomBytes(6).toString('base64url'),
      url,
      key,
      title: prettyUrl(url),
      source: sourceOf(url),
      tags: normalizeTags([...tags, ...own], known),
      n: i + 1,
    };
  });
  const { rows: added } = await query(
    `INSERT INTO links (id, url, url_key, title, source, user_tags, tags, collection, note, created_at)
     SELECT new.id, new.url, new.key, new.title, new.source, new.tags, new.tags, $2, $3, now() - (new.n * interval '1 millisecond')
     FROM jsonb_to_recordset($1::jsonb) AS new(id text, url text, key text, title text, source text, tags text[], n int)
     ON CONFLICT (url_key) DO NOTHING
     RETURNING ${FIELDS}`,
    [JSON.stringify(rows), collection.trim().slice(0, 80), note.trim().slice(0, 1000)],
  );
  result.added = added.map(toLink).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return result;
}

// Which addresses are already in the library (and which are the same page or website as a saved link) is
// checkUrls in duplicates.js, for the "Add links" window.

// ---------- Editing ----------

const EDITABLE = { title: 'title', summary: 'summary', useFor: 'use_for', category: 'category', collection: 'collection', note: 'note' };

// Returns the saved link, and whether its words changed (then its meaning fingerprint needs an update).
export async function updateLink(id, changes) {
  const sets = [];
  const params = [id];
  const set = (column, value, cast = '') => {
    params.push(value);
    sets.push(`${column} = $${params.length}${cast}`);
  };
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (typeof changes[key] === 'string') set(column, changes[key].trim().slice(0, key === 'note' || key === 'summary' ? 1000 : 200));
  }
  if (Array.isArray(changes.tags)) {
    // Tags you set by hand are kept even when the AI runs again.
    const tags = normalizeTags(changes.tags, await knownTags());
    set('tags', tags, '::text[]');
    set('user_tags', tags, '::text[]');
  }
  if (Array.isArray(changes.tasks)) {
    set('tasks', changes.tasks.map(task => String(task).replace(/\s+/g, ' ').trim().slice(0, 80)).filter(Boolean).slice(0, 10), '::text[]');
  }
  const wordsChanged = sets.length > 0;
  if (typeof changes.favorite === 'boolean') set('favorite', changes.favorite);
  if (changes.myStatus === '' || MY_STATUSES.includes(changes.myStatus)) set('my_status', changes.myStatus);
  if (!sets.length) return { link: await getLink(id), wordsChanged: false };
  // Only real changes count as "updated", so a click on the star doesn't redraw the map.
  const { rows } = await query(
    `UPDATE links SET ${sets.join(', ')}${wordsChanged ? ', updated_at = now()' : ''} WHERE id = $1 RETURNING ${DETAIL_FIELDS}`,
    params,
  );
  return { link: rows[0] ? toLink(rows[0]) : null, wordsChanged };
}

// Changes many links at once: add a tag, move them to a collection, read them again, or delete them.
// `reword` are the links whose words changed, so their meaning fingerprint needs an update.
export const BULK_ACTIONS = ['tag', 'collection', 'refresh', 'delete'];
export async function bulkChange(ids, action, value = '') {
  if (action === 'delete') {
    const { rows } = await query('DELETE FROM links WHERE id = ANY($1) RETURNING id', [ids]);
    return { changed: rows.length, reword: [] };
  }
  if (action === 'refresh') {
    const { rows } = await query(
      `UPDATE links SET status = 'queued', ai_status = 'pending', attempts = 0, error = '', updated_at = now()
       WHERE id = ANY($1) RETURNING id`,
      [ids],
    );
    return { changed: rows.length, reword: [] };
  }
  if (action === 'collection') {
    const { rows } = await query('UPDATE links SET collection = $2, updated_at = now() WHERE id = ANY($1) RETURNING id', [ids, value.trim().slice(0, 80)]);
    return { changed: rows.length, reword: rows.map(row => row.id) };
  }
  if (action === 'tag') {
    // Added as your own tag, so the AI never takes it away again.
    const [tag] = normalizeTags([value], await knownTags());
    if (!tag) return { changed: 0, reword: [] };
    const { rows } = await query('SELECT id, tags, user_tags FROM links WHERE id = ANY($1)', [ids]);
    for (const row of rows) {
      await query('UPDATE links SET tags = $2, user_tags = $3, updated_at = now() WHERE id = $1', [
        row.id,
        normalizeTags([...row.tags, tag]),
        normalizeTags([...row.user_tags, tag]),
      ]);
    }
    return { changed: rows.length, reword: rows.map(row => row.id) };
  }
  return { changed: 0, reword: [] };
}

// Counts how often you open a link, so the ones you use most come up first.
export async function recordOpen(id) {
  await query('UPDATE links SET opens = opens + 1, opened_at = now() WHERE id = $1', [id]);
}

export async function deleteLink(id) {
  const { rows } = await query('DELETE FROM links WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

// Asks the robot to read the link again and rewrite its summary.
export async function requeueLink(id) {
  const { rows } = await query(
    `UPDATE links SET status = 'queued', ai_status = 'pending', attempts = 0, error = '', updated_at = now()
     WHERE id = $1 RETURNING ${FIELDS}`,
    [id],
  );
  return rows[0] ? toLink(rows[0]) : null;
}

export async function setEmbedding(id, vector) {
  await query('UPDATE links SET embedding = $2::vector WHERE id = $1', [id, vector]);
}

export async function allLinks() {
  const { rows } = await query(`SELECT ${DETAIL_FIELDS} FROM links ORDER BY created_at DESC`);
  return rows.map(toLink);
}
