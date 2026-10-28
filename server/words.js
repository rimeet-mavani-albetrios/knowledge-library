// What you type in the search box: the words that matter, and spelling mistakes fixed.
//
// "I want a tool to convert pdf to excel" → convert, pdf, excel
// "image genration" → "image generation": the library keeps a list of the words in your saved websites,
// and a word you type that isn't anywhere in the library is swapped for the closest word that is.
import { query } from './db.js';

// Words that don't say what you're looking for. (The first lines are Postgres' own English stop words.)
const STOP_WORDS = new Set(`
  i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her hers herself it its
  itself they them their theirs themselves what which who whom this that these those am is are was were be been being have
  has had having do does did doing a an the and but if or because as until while of at by for with about against between
  into through during before after above below to from up down in out on off over under again further then once here there
  when where why how all any both each few more most other some such no nor not only own same so than too very s t can will
  just don should now
  want wants need needs find looking look something thing things way ways help use using like please get
`.split(/\s+/).filter(Boolean));

// Filler words: in "a website to convert pdf" they say little, but in "make a website" they're the point.
// So they stay in the search but count half (see wordWeights in links.js). The same for everyday verbs:
// in "make a website", the website is what matters.
const WEAK_WORDS = new Set('tool tools website websites site sites app apps online best good make makes making create creates creating'.split(' '));
export const isWeak = word => WEAK_WORDS.has(word);

// "Convert PDF to Excel!" → ['convert', 'pdf', 'excel']. If every word is a stop word, they're kept.
export function searchWords(text) {
  const all = (String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(word => word.length > 1 || /\d/.test(word));
  const meaningful = all.filter(word => !STOP_WORDS.has(word));
  return [...new Set(meaningful.length ? meaningful : all)].slice(0, 10);
}

// ---------- Spelling ----------

// Every trip to the database takes time (about 0.3 s from India to a database in the US), so the word list is
// checked for changes at most once a minute instead of on every search.
const RECHECK = 60_000;
let cache = { key: '', words: new Map(), checked: 0, found: new Map() };

// Every word in the names, tasks, tags, search words, headings and summaries, with how many links use it.
export async function vocabulary() {
  if (Date.now() - cache.checked < RECHECK) return cache.words;
  const { rows: [state] } = await query('SELECT count(*)::int AS n, max(updated_at) AS changed FROM links');
  const key = `${state.n}:${state.changed}`;
  if (cache.key === key) {
    cache.checked = Date.now();
    return cache.words;
  }
  const { rows } = await query(
    `SELECT word, count(*)::int AS n FROM links,
       regexp_split_to_table(lower(title || ' ' || array_to_string(tasks, ' ') || ' ' || array_to_string(tags, ' ') || ' ' ||
         array_to_string(search_words, ' ') || ' ' || array_to_string(headings, ' ') || ' ' || summary || ' ' || overview || ' ' ||
         use_for || ' ' || category || ' ' || features::text), '[^a-z0-9]+') AS word
     WHERE length(word) >= 3
     GROUP BY word`,
  );
  cache = { key, words: new Map(rows.map(row => [row.word, row.n])), checked: Date.now(), found: new Map() };
  return cache.words;
}

// How many letters you have to add, remove, change or swap to turn one word into the other.
// Gives up early (returns max + 1) once it's clear the words are further apart than `max`.
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let smallest = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (before && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], before[j - 2] + 1);
      smallest = Math.min(smallest, row[j]);
    }
    if (smallest > max) return max + 1;
    before = previous;
    previous = row;
  }
  return previous[b.length];
}

// "videos" is fine when the library says "video", and "ollam" is fine while you're still typing "ollama".
function looksKnown(word, words) {
  if (words.has(word) || words.has(`${word}s`) || words.has(word.replace(/e?s$/, ''))) return true;
  for (const known of words.keys()) if (known.startsWith(word)) return true;
  return false;
}

// Is the word anywhere in the library, even deep in a page's text? Then it's not a mistake.
// The answer is kept until the word list changes.
async function inLibrary(word) {
  const { found } = cache;
  if (!found.has(word)) {
    const { rows } = await query(`SELECT 1 FROM links WHERE search @@ to_tsquery('english', $1) LIMIT 1`, [word]);
    found.set(word, rows.length > 0);
  }
  return found.get(word);
}

function closest(word, words) {
  const max = word.length >= 7 ? 2 : 1;
  let best = null;
  for (const [candidate, count] of words) {
    const d = distance(word, candidate, max);
    if (d <= max && (!best || d < best.d || (d === best.d && count > best.count))) best = { word: candidate, d, count };
  }
  return best?.word ?? null;
}

// Returns the fixed search text, or null when nothing needed fixing.
export async function fixSpelling(text) {
  const parts = String(text).split(/(\s+)/);
  let changed = false;
  for (let i = 0; i < parts.length; i++) {
    const word = parts[i].toLowerCase();
    if (!/^[a-z]{4,}$/.test(word) || STOP_WORDS.has(word)) continue;
    const words = await vocabulary();
    if (looksKnown(word, words) || (await inLibrary(word))) continue;
    const better = closest(word, words);
    if (better) {
      parts[i] = better;
      changed = true;
    }
  }
  return changed ? parts.join('') : null;
}
