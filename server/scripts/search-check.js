// How good is search? Everyday searches, each with the links you'd expect near the top. This prints where each
// expected link landed and a total score, so a change to search can be measured instead of guessed.
// It only reads, and only from a test copy: it refuses to run on the real database.
//
//   PGLITE_DIR=<test copy> node server/scripts/search-check.js              the check
//   PGLITE_DIR=<test copy> node server/scripts/search-check.js --top 5      the same, with each search's first 5 results
//   PGLITE_DIR=<test copy> node server/scripts/search-check.js --file my.json    another list: [{ "q": "...", "want": ["..."] }]
//   PGLITE_DIR=<test copy> node server/scripts/search-check.js --json out.json   also saves the results to a file
//   node server/scripts/search-check.js --list                              only the list below (no database needed)
//
// Points for each expected link, by its place: how many other links come above it, not counting the other expected
// links of that search. So two expected links at #1 and #2 are both perfect.
import fs from 'node:fs';

// The owner knows these links best: change this list whenever an answer looks wrong. `want` are names of saved links.
const EVERYDAY_SEARCHES = [
  { q: 'run AI on my own computer', want: ['Ollama', 'Jan'] },
  { q: 'convert pdf to excel', want: ['docbatch.ai'] },
  { q: 'whatsapp api', want: ['Twilio WhatsApp Business API'] },
  { q: 'send cold emails', want: ['Instantly', 'Mailmeteor'] },
  { q: 'shadcn blocks', want: ['Shadcnblocks'] },
  { q: 'test my website automatically', want: ['Testsigma', 'BrowserStack'] },
  { q: 'schedule social media posts', want: ['Buffer', 'Publer'] },
  { q: 'take meeting notes', want: ['Granola', 'Circleback'] },
  { q: 'make a presentation with ai', want: ['Gamma'] },
  { q: 'type with my voice', want: ['Wispr Flow', 'Aqua Voice'] },
  { q: 'translate a pdf', want: ['DeepL Translator'] },
  { q: 'make a blurry photo sharp', want: ['Magnific', 'Cutout.Pro Photo Enhancer'] },
  { q: 'auto reply to instagram comments', want: ['Manychat', 'InstantDM'] },
  { q: 'add login to my app', want: ['Clerk', 'Kinde'] },
  { q: 'host my web app', want: ['Render', 'Railway'] },
  { q: 'free postgres database', want: ['Neon', 'Supabase'] },
  { q: 'scrape data from a website', want: ['Firecrawl', 'Apify'] },
  { q: 'connect my apps without code', want: ['Zapier', 'Make'] },
  { q: 'tell me when my website goes down', want: ['UptimeRobot'] },
  { q: 'see who visits my website', want: ['Plausible Analytics', 'Umami'] },
  { q: 'send emails from my app', want: ['Resend'] },
  { q: 'draw a diagram', want: ['Excalidraw', 'Eraser'] },
  { q: 'write linkedin posts', want: ['Taplio'] },
  { q: 'compare ai models', want: ['Artificial Analysis', 'Arena Leaderboard'] },
];

const PLACE_POINTS = [[1, 10], [2, 8], [3, 6], [5, 4], [12, 2], [24, 1]]; // [up to this place, points]
const FULL_POINTS = PLACE_POINTS[0][1];
const pointsFor = place => PLACE_POINTS.find(([upTo]) => place <= upTo)?.[1] ?? 0;
const TIMED_RUNS = 3; // each search runs this many times, and the middle time counts: one slow moment doesn't decide

const option = name => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? '');
};
const file = option('--file');
const checks = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : EVERYDAY_SEARCHES;

if (process.argv.includes('--list')) {
  checks.forEach((check, i) => console.log(`${i + 1}. "${check.q}" → ${check.want.join(', ')}`));
  process.exit(0);
}

if (process.env.DATABASE_URL || !process.env.PGLITE_DIR) {
  console.error('This check only runs on a test copy: set PGLITE_DIR to its folder, and leave DATABASE_URL empty.');
  process.exit(1);
}

// Loaded here, after the safety check above: opening these is what connects to the database.
const { connect, query } = await import('../db.js');
const { searchLinks, searchIds, facets } = await import('../links.js');
const { fixSpelling } = await import('../words.js');
const { embedQuery, toSqlVector } = await import('../robot/embed.js');

await connect();
await query('SET default_transaction_read_only = on'); // from here on the database refuses any change

const { rows: all } = await query('SELECT id, title FROM links');
const idsOf = title => all.filter(row => row.title.toLowerCase() === title.toLowerCase()).map(row => row.id);

const top = Number(option('--top')) || 0;
const results = [];
for (const { q: typed, want } of checks) {
  // The same steps as the website's search (api.js): spelling first, then the meaning, then the list.
  const q = (await fixSpelling(typed)) ?? typed;
  const vector = toSqlVector(await embedQuery(q));
  const times = [];
  let page;
  for (let run = 0; run < TIMED_RUNS; run++) {
    const started = performance.now();
    page = await searchLinks({ q, vector, limit: Math.max(top, 1) });
    times.push(performance.now() - started);
  }
  const ms = Math.round(times.sort((a, b) => a - b)[Math.floor(TIMED_RUNS / 2)]);
  const { ids } = await searchIds({ q, vector });
  const { total } = await facets({ q, vector });
  const wanted = new Set(want.flatMap(idsOf));

  const links = want.map(title => {
    const copies = idsOf(title);
    const ranks = copies.map(id => ids.indexOf(id) + 1).filter(Boolean);
    const rank = ranks.length ? Math.min(...ranks) : null; // two saved links with one name: the better one counts
    const place = rank && 1 + ids.slice(0, rank - 1).filter(id => !wanted.has(id)).length;
    return { title, rank, place, best: rank !== null && rank <= page.bestTotal, saved: copies.length > 0, points: rank ? pointsFor(place) : 0 };
  });
  const agree = ids.length === page.total && total === page.total;
  results.push({ q: typed, used: q, links, ms, total: page.total, bestTotal: page.bestTotal, agree, points: links.reduce((sum, link) => sum + link.points, 0), full: want.length * FULL_POINTS });

  console.log(`\n"${typed}"${q !== typed ? ` (spelling fixed: "${q}")` : ''}: ${page.total} results, ${page.bestTotal} best matches, ${ms} ms`);
  for (const link of links) {
    const where = !link.saved ? 'NOT SAVED (name changed?)' : link.rank ? `#${link.rank}${link.best ? ' best' : ' related'}` : 'NOT FOUND';
    console.log(`  ${where.padEnd(14)} ${link.title} (${link.points} points)`);
  }
  if (!agree) console.log(`  COUNTS DISAGREE: list ${page.total}, Select all ${ids.length}, filter counts ${total}`);
  if (top) {
    const shown = page.items.map(item => `${wanted.has(item.id) ? '*' : ' '} ${item.title}`);
    console.log(`  Top ${top}:\n    ${shown.join('\n    ')}`);
  }
}

const score = results.reduce((sum, result) => sum + result.points, 0);
const full = results.reduce((sum, result) => sum + result.full, 0);
const every = results.flatMap(result => result.links);
const within = n => every.filter(link => link.place && link.place <= n).length;
const times = results.map(result => result.ms).sort((a, b) => a - b);
const summary = {
  score,
  full,
  percent: Math.round((score / full) * 100),
  links: every.length,
  top1: within(1),
  top3: within(3),
  top5: within(5),
  bestMatches: every.filter(link => link.best).length,
  notFound: every.filter(link => !link.rank).length,
  medianMs: times[Math.floor(times.length / 2)],
  slowestMs: times.at(-1),
  countsDisagree: results.filter(result => !result.agree).map(result => result.q),
};
console.log(`\nScore: ${score} of ${full} (${summary.percent}%)`);
console.log(`Of ${every.length} expected links: ${summary.top1} first, ${summary.top3} in the top 3, ${summary.top5} in the top 5, ${summary.bestMatches} in "Best matches", ${summary.notFound} not found.`);
console.log(`Speed: ${summary.medianMs} ms for a usual search, ${summary.slowestMs} ms for the slowest (the list only; the meaning fingerprint is extra).`);
if (summary.countsDisagree.length) console.log(`Counts disagree on: ${summary.countsDisagree.join(', ')}`);

const out = option('--json');
if (out) fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 1));
process.exit(0);
