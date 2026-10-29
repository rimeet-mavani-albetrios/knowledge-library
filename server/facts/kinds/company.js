// Who runs the website: the company's name, country and city, and where it keeps your data. Read from the
// website's own Privacy or Terms page by the free AI (a short part of the page, to save the daily limit).
// When the page doesn't say, Wikidata's answer is used. A separate small reader: the robot itself skips these pages.
import { chat, aiEnabled } from '../../robot/ai.js';
import { readPage } from '../../robot/page.js';
import { sameName } from '../site.js';

const MAX_TEXT = 2500; // letters of the page sent to the AI
const PRIVACY = /privacy|datenschutz|confidentialit/i;
const TERMS = /\b(terms|tos|legal|conditions|imprint|impressum)\b/i;
// Sentences that usually name the company: "Notion Labs, Inc.", "registered office", "data controller"…
const CLUES = new RegExp(
  [
    '\\b(inc|llc|ltd|limited|gmbh|corp|corporation|plc|pbc|pvt|pty|s\\.a\\.|sas|b\\.v\\.|ag|oy|ab|s\\.r\\.l)\\b\\.?',
    'registered (office|address|in)', 'headquarter', 'located (at|in)', 'operated by', 'controller', 'our address',
    'governed by the laws', 'stored (in|on)', 'servers? (are )?located', 'transfer(red)? to', 'company number',
  ].join('|'),
  'gi',
);
const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();

// The start of the page plus the parts around the clues, up to MAX_TEXT letters.
export function bestParts(text) {
  const parts = [[0, 700]];
  for (const match of text.matchAll(CLUES)) {
    const start = Math.max(0, match.index - 220);
    const last = parts.at(-1);
    if (start <= last[1]) last[1] = Math.max(last[1], match.index + 260);
    else parts.push([start, match.index + 260]);
    if (parts.reduce((sum, [a, b]) => sum + b - a, 0) >= MAX_TEXT) break;
  }
  return parts.map(([a, b]) => text.slice(a, b)).join(' … ').slice(0, MAX_TEXT);
}

// The Privacy and Terms pages the home page links to (on the same website, or its sister: notion.so → notion.com).
function legalPages(anchors, domain) {
  const ours = anchors.filter(anchor => {
    try {
      return sameName(new URL(anchor.url).hostname, domain);
    } catch {
      return false;
    }
  });
  const pick = test => ours.find(anchor => test.test(`${anchor.text} ${new URL(anchor.url).pathname}`))?.url ?? null;
  return { privacy: pick(PRIVACY), terms: pick(TERMS) };
}

async function askAi(host, label, text) {
  const response = await chat(
    [
      { role: 'system', content: 'You read parts of a website’s legal page and pull out facts. Answer with one JSON object and nothing else.' },
      {
        role: 'user',
        content: `Website: ${host}
Parts of its ${label} page:
"""
${text}
"""

Return JSON with these keys:
- "name": the legal name of the company that runs this website (for example "Notion Labs, Inc."), or null
- "country": the 2-letter ISO code of the country where that company is based (for example "US"), or null
- "city": the city of its office, or null
- "dataRegion": where users' data is stored: a 2-letter country code, or "EU", or null

Use only what the text says. If it doesn't say, use null.`,
      },
    ],
    500,
  );
  const content = response.choices?.[0]?.message?.content ?? '';
  const answer = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  const code = value => (/^[A-Za-z]{2}$/.test(clean(value)) ? clean(value).toUpperCase() : null);
  const name = clean(answer.name);
  return {
    name: name && name.length <= 120 && !/^(null|none|unknown)$/i.test(name) ? name : null,
    country: code(answer.country),
    city: clean(answer.city).slice(0, 60) || null,
    dataRegion: /^(eu|eea)$/i.test(clean(answer.dataRegion)) ? 'EU' : code(answer.dataRegion),
  };
}

export default {
  kind: 'company',
  everyDays: 90,
  perRun: 4,
  sources: ['web'],
  order: 30, // after `wikidata`, its fallback
  ai: true,
  async collect(link, facts, ctx) {
    const home = await ctx.home();
    if (!home.ok && !home.final) throw new Error(`home page not readable (${home.status ?? home.error})`);
    const policy = legalPages(home.ok ? home.anchors : [], ctx.domain);
    // Websites built with scripts often have no links in their code: try the usual address.
    if (!policy.privacy && (home.ok || home.status)) {
      const guess = await readPage(`${ctx.origin}/privacy`, { timeout: 10_000 });
      if (guess.ok && guess.text && PRIVACY.test(`${guess.title} ${guess.finalUrl}`)) policy.privacy = guess.finalUrl;
    }

    let found = null;
    if (aiEnabled()) {
      for (const [label, url] of [['privacy policy', policy.privacy], ['terms', policy.terms]]) {
        if (!url) continue;
        const page = await readPage(url, { timeout: 15_000 });
        if (!page.ok || !page.text) continue;
        found = await askAi(ctx.host, label, bestParts(page.text));
        if (found.name) break;
      }
    }
    const wiki = facts.wikidata;
    if (found?.name) return { ...found, source: 'terms', policy };
    if (wiki?.name) return { name: wiki.name, country: wiki.country, city: wiki.city, dataRegion: found?.dataRegion ?? null, source: 'wikidata', policy };
    return policy.privacy || policy.terms ? { name: null, country: null, city: null, dataRegion: found?.dataRegion ?? null, source: null, policy } : null;
  },
};
