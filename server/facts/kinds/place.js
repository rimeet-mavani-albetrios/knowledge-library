// The one country of each link, for the country filter, the Stats page and the world map, and where that answer
// came from: { country: "IN", source, from }. No paid service and no AI: it uses what is already known, from the
// most sure answer to the least sure one:
//   platform  a big website of other people's pages (YouTube, Amazon…): where that company is based   from: "youtube.com"
//   company   the website's own Privacy or Terms page (kinds/company.js)
//   wikidata  Wikidata, the free encyclopedia of facts (kinds/wikidata.js)
//   website   another saved page of the same website that has a country (docs.doubletick.io ← doubletick.io)   from: "doubletick.io"
//   github    a GitHub repository: the "location" on its owner's profile   from: owner, location: "Bengaluru, India"
//   ending    a country's own address ending, as a last guess   from: ".in"
// It is worked out again whenever the company or Wikidata facts change (`follows`), and when a page of the same
// website learns its own country (`saved`), so all pages of one website agree.
import { query } from '../../db.js';
import { mainDomain, isPlatform } from '../../robot/domain.js';
import { GithubLimited, githubLimit, parseOwner, readOwner } from '../../robot/github.js';
import { countryFromEnding, countryFromText, isCountry, platformHome } from '../countries.js';

const HOUR = 3600_000;
const OWN = new Set(['company', 'wikidata']); // answers about the website itself, which other pages may share

// GitHub allows 60 questions an hour without a token, shared with the robot's other GitHub reads (new repos, stars).
// Owners are looked up slowly: a few an hour, one at a time, and never the last ones of the hour.
const WITH_TOKEN = Boolean(process.env.GITHUB_TOKEN);
const PER_HOUR = WITH_TOKEN ? 300 : 15;
const KEEP = WITH_TOKEN ? 200 : 20; // questions always left for the robot's own reads
const GAP_MS = 1500; // time between two owner lookups
const MAX_REMEMBERED = 2000;

let hour = { start: 0, asked: 0 };
let line = Promise.resolve(); // owner lookups wait in this line, one after the other
const owners = new Map(); // owner (small letters) → answer or null, so repos of one owner ask only once

const code = value => (isCountry(String(value ?? '').trim().toUpperCase()) ? String(value).trim().toUpperCase() : null);
const hostOf = url => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};
// "%" and "_" mean "anything" in LIKE; a web address can't have them, but stay safe.
const likeDomain = domain => `%${domain.replace(/[\\%_]/g, '\\$&')}%`;

// The other saved pages of the same website (not on platforms, where each page is someone else's).
async function samesite(link, extra = '') {
  const domain = mainDomain(link.url);
  if (!domain || isPlatform(link.url)) return [];
  const { rows } = await query(
    `SELECT l.id, l.url, coalesce(f.facts, '{}') AS facts FROM links l LEFT JOIN link_facts f ON f.link_id = l.id
     WHERE l.id <> $1 AND l.url ILIKE $2 ${extra}`,
    [link.id, likeDomain(domain)],
  );
  return rows.filter(row => mainDomain(row.url) === domain);
}

// The country most pages of the same website have from their own legal page or Wikidata. `from` is the page's
// address that is closest to the website's home ("doubletick.io" before "app.doubletick.io").
async function fromWebsite(link) {
  const votes = new Map(); // country → { n, from }
  for (const row of await samesite(link)) {
    const country = code(row.facts.company?.country) ?? code(row.facts.wikidata?.country);
    if (!country) continue;
    const vote = votes.get(country) ?? { n: 0, from: null };
    const host = hostOf(row.url);
    vote.n++;
    if (!vote.from || host.length < vote.from.length) vote.from = host;
    votes.set(country, vote);
  }
  const [best] = [...votes].sort((a, b) => b[1].n - a[1].n);
  return best ? { country: best[0], source: 'website', from: best[1].from } : null;
}

// Waits its turn in the line, so lookups are spread out instead of all at once.
function inLine(task) {
  const run = line.then(task);
  line = run.catch(() => {}).then(() => new Promise(resolve => setTimeout(resolve, GAP_MS)));
  return run;
}

// A GitHub repository (or profile): the country on its owner's profile. Throws GithubLimited (try again after the
// hour) when this hour's share of GitHub questions is used.
async function fromGithub(link) {
  const login = parseOwner(link.url);
  if (!login) return null;
  const key = login.toLowerCase();
  if (owners.has(key)) return owners.get(key);
  // Another repository of the same owner was looked up before.
  const { rows } = await query(
    `SELECT facts -> 'place' AS place FROM link_facts WHERE facts #>> '{place,source}' = 'github' AND lower(facts #>> '{place,from}') = $1 LIMIT 1`,
    [key],
  );
  if (rows[0]?.place) return rows[0].place;

  return inLine(async () => {
    if (owners.has(key)) return owners.get(key); // asked while this one waited in line
    if (Date.now() - hour.start > HOUR) hour = { start: Date.now(), asked: 0 };
    const limit = githubLimit();
    if (hour.asked >= PER_HOUR) throw new GithubLimited(hour.start + HOUR);
    if (limit.left !== null && limit.left <= KEEP) throw new GithubLimited(limit.resetAt + 60_000);
    hour.asked++;
    const user = await readOwner(login);
    if (!user) throw new Error('GitHub could not be reached');
    const country = user.missing ? null : countryFromText(user.location);
    const answer = country ? { country, source: 'github', from: user.login, location: user.location } : null;
    if (owners.size >= MAX_REMEMBERED) owners.clear();
    owners.set(key, answer);
    return answer;
  });
}

// "linktr.ee" is Linktree and "screenpi.pe" is Screenpipe: there the ending is part of the name, not a country.
function nameTrick(link, host) {
  const word = host.split('.').slice(-2).join('');
  const words = text => ` ${String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')}`;
  return [link.title, link.siteName].some(text => words(text).includes(` ${word}`));
}

export async function bestPlace(link, facts = {}) {
  const platform = platformHome(link.url);
  if (platform) return { country: platform.country, source: 'platform', from: platform.domain };
  const company = code(facts.company?.country);
  if (company) return { country: company, source: 'company', from: null };
  const wikidata = code(facts.wikidata?.country);
  if (wikidata) return { country: wikidata, source: 'wikidata', from: null };
  const website = await fromWebsite(link);
  if (website) return website;
  if (link.source === 'github') {
    const owner = await fromGithub(link);
    if (owner) return owner;
  }
  const host = hostOf(link.url);
  const ending = isPlatform(link.url) || nameTrick(link, host) ? null : countryFromEnding(host);
  return ending ? { country: ending.country, source: 'ending', from: ending.ending } : null;
}

export default {
  kind: 'place',
  everyDays: 30,
  perRun: 200, // quick: mostly answers already in the database
  order: 40, // after `company` (30) and `wikidata` (10), whose answers it uses
  follows: ['company', 'wikidata'],
  collect(link, facts) {
    return bestPlace(link, facts);
  },
  // This page's own country changed: the other pages of the same website that borrowed (or could borrow) it are
  // worked out again in the next round.
  async saved(link, oldValue, newValue) {
    const own = value => OWN.has(value?.source);
    if (!own(oldValue) && !own(newValue)) return;
    if (oldValue?.country === newValue?.country && oldValue?.source === newValue?.source) return;
    const others = await samesite(link, `AND coalesce(f.facts #>> '{place,source}', '') NOT IN ('company', 'wikidata')`);
    if (!others.length) return;
    await query(`UPDATE link_facts SET checked = checked - 'place' WHERE link_id = ANY($1)`, [others.map(row => row.id)]);
  },
};
