// What's new: the features a website lists, { list: ['Offline mode', 'Export to PDF', …], url, page }. Checked monthly.
// `page` is a short copy of the page (its headings and the start of its text) from the last check.
// The first check is only the starting point: the AI lists the features. After that the page is compared word by word
// with last month's copy. When nothing was added, that's the end (no AI question). Otherwise the AI reads only the
// added parts and names the features that are truly new (one described in other words doesn't count). Each one
// joins the list and adds a `feature` row to the link's history ("What's new since you saved it").
import { pageLinkOf, pathOf, readNow, askJson, clean, nameKey } from '../watch.js';

const MAX_TEXT = 2500; // letters of the page the AI reads (plus its headings), and of the copy kept for next time
const MAX_ADDED = 1500; // letters of added text the AI reads on a later check
const MAX_FEATURES = 60; // the list remembers this many; the oldest drop off
// Kinds of links that are about something, not products with features.
const NOT_PRODUCTS = new Set([
  'Article', 'News', 'Book', 'Video & Podcast', 'Tutorial & Course', 'Community', 'Directory & List', 'Prompts',
  'Dataset', 'Documentation',
]);
const FILLER = new Set(['a', 'an', 'and', 'the', 'to', 'for', 'of', 'with', 'in', 'on', 'your', 'you', 'by', 'from', 'new']);

const depth = url => pathOf(url).split('/').filter(Boolean).length;

// The website's main features page (/features, /product), else its front page (ollama.com, notion.so/product).
// A page about one feature (/features/chat), the blog or an article deep inside a website would give a narrow list.
function featuresPage(link) {
  if ((link.source ?? 'web') !== 'web' || NOT_PRODUCTS.has(link.category)) return '';
  const found = pageLinkOf(link, 'Features');
  if (found && depth(found) === 1 && /feature|product/i.test(pathOf(found))) return found;
  return depth(link.url) <= 1 ? link.url : '';
}

const words = name => new Set(nameKey(name).split(' ').filter(word => word && !FILLER.has(word)).map(word => word.replace(/(?<=\w{3})s$/, '')));

// "PDF export" and "Export to PDF" are the same feature; "AI chat" and "AI image generator" are not.
function sameFeature(a, b) {
  const [x, y] = [words(a), words(b)];
  if (!x.size || !y.size) return nameKey(a) === nameKey(b);
  let shared = 0;
  for (const word of x) if (y.has(word)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

const featureList = value =>
  (Array.isArray(value) ? value : [])
    .map(item => clean(item).replace(/[.:;]+$/, ''))
    .filter(item => item.length >= 3 && item.length <= 60);

const copyOf = page => ({ headings: page.headings.slice(0, 25), text: page.text.slice(0, MAX_TEXT) });

// What the page says now that last month's copy didn't: new headings, and runs of 3 or more new words in the text,
// found word by word like "track changes" (the longest run of unchanged words between the two). New words after
// the last unchanged one are left out: both copies are cut at the same length, so a page that got shorter at the
// top shows more of its bottom without anything being added.
function addedParts(before, after) {
  const known = new Set(before.headings.map(nameKey));
  const headings = after.headings.filter(heading => !known.has(nameKey(heading)));
  const key = word => word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const a = before.text.split(' ').map(key);
  const shown = after.text.split(' ');
  const b = shown.map(key);
  const same = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      same[i][j] = a[i] === b[j] ? same[i + 1][j + 1] + 1 : Math.max(same[i + 1][j], same[i][j + 1]);
    }
  }
  const runs = [];
  let run = [];
  for (let i = 0, j = 0; j < b.length; ) {
    if (i < a.length && a[i] === b[j]) {
      if (run.length >= 3) runs.push(run.join(' '));
      run = [];
      i++;
      j++;
    } else if (i < a.length && same[i + 1][j] >= same[i][j + 1]) {
      i++;
    } else {
      run.push(shown[j++]);
    }
  }
  return { headings, runs };
}

function pageBlock(url, page) {
  return `Page: ${url}
Headings: ${page.headings.slice(0, 25).join(' | ') || '(none)'}
Text (may be cut off):
"""
${page.text.slice(0, MAX_TEXT)}
"""`;
}

const firstPrompt = (url, page) => `${pageBlock(url, page)}

List the product's features: the things it lets you do or has. Return JSON: {"features": ["Offline mode", "Export to PDF"]}
- up to 25 features, each 2 to 6 plain words
- only features the text above names; no prices, plans, customers, awards or slogans
- {"features": []} when it names none`;

function againPrompt(url, list, added) {
  let room = MAX_ADDED;
  const runs = added.runs.map(run => run.slice(0, 300)).filter(run => (room -= run.length) >= 0);
  return `A website's features, as noted last month:
${list.map(item => `- ${item}`).join('\n')}

New on its page (${url}) since then:
${added.headings.length ? `New headings: ${added.headings.join(' | ')}\n` : ''}${runs.length ? `New text:\n${runs.map(run => `- "${run}"`).join('\n')}` : ''}

Which of these name a feature the website did not have before, one that is not in the list above in any wording?
Marketing lines, customer names, prices, dates and numbers are not features. A feature close to one in the list
(the same thing in other words, or a part of it) is not new.
Return JSON: {"new": ["…"]}, each 2 to 6 plain words, or {"new": []} when there is none.`;
}

export default {
  kind: 'features',
  everyDays: 30,
  // A few links per round (the daily wake-up, and every 15 minutes while you use the library): one AI question
  // each, and the free daily limit is shared with everything else. A link you open is checked right away.
  perRun: 6,
  needs: ['GROQ_API_KEY'],
  sources: ['web'],
  ai: true,

  async collect(link, facts) {
    const url = featuresPage(link);
    if (!url) return null;
    const old = facts?.features?.list?.length ? facts.features : null;
    const page = await readNow(url);
    if (!page) return old; // can't read it now: keep what we know, and look again next time
    const copy = copyOf(page);

    if (!old) {
      const list = featureList((await askJson(firstPrompt(url, page), 900)).features).slice(0, 25);
      const unique = list.filter((item, i) => !list.slice(0, i).some(other => sameFeature(other, item)));
      return unique.length ? { list: unique, url, page: copy } : null;
    }
    // Another page than last time (or no copy kept): this check is the new starting point.
    if (old.url !== url || !old.page) return { ...old, url, page: copy };

    const added = addedParts(old.page, copy);
    if (!added.headings.length && !added.runs.length) return { ...old, page: copy };
    const answer = await askJson(againPrompt(url, old.list, added), 700);
    const fresh = [];
    for (const item of featureList(answer.new).slice(0, 10)) {
      if (![...old.list, ...fresh].some(other => sameFeature(other, item))) fresh.push(item);
    }
    return { list: [...old.list, ...fresh].slice(-MAX_FEATURES), url, page: copy };
  },

  // The features in the new list that weren't in the old one. The first check adds none.
  async changes(link, before, after) {
    if (!before?.list?.length || !after?.list?.length) return [];
    const known = new Set(before.list.map(nameKey));
    return after.list.filter(name => !known.has(nameKey(name))).map(name => ({ kind: 'feature', data: { name } }));
  },
};
