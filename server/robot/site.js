// Reads a website the way a person looks around it: the page you saved, plus up to 3 of its most useful pages
// (features, pricing, docs…). It also picks out the important links on the page: Docs, Pricing, Download…
import { readPage } from './page.js';
import { hostOf } from './url.js';

const MAX_EXTRA_PAGES = 3;
const EXTRA_PAGE_TEXT = 4000;

// [label, test on the link's words and address]. The first matching kind wins.
const LINK_KINDS = [
  ['Docs', /\b(docs?|documentation|developers?|api reference|guides?)\b/],
  ['Pricing', /\b(pricing|plans|prices?)\b/],
  ['Download', /\b(download|downloads|install)\b/],
  ['Features', /\b(features|product|how it works)\b/],
  ['Get started', /\b(get started|getting started|quick ?start|sign ?up|try (it )?(for )?free|start (for )?free)\b/],
  ['Examples', /\b(examples?|templates?|showcase|gallery|use cases?)\b/],
  ['FAQ', /\b(faqs?|help center|help|support)\b/],
  ['About', /\b(about|about us)\b/],
  ['Blog', /\bblog\b/],
];

// The robot reads these kinds of pages, in this order. Sign-up pages and blogs say little about the website itself.
const WORTH_READING = ['Features', 'Pricing', 'Docs', 'FAQ', 'About', 'Examples'];

const NOT_USEFUL = /\b(log ?in|sign ?in|account|cart|checkout|privacy|terms|legal|cookies?|careers|jobs|press)\b/;
const FILE = /\.(pdf|zip|png|jpe?g|gif|svg|mp4|dmg|exe)$/i;

// ollama.com, www.ollama.com and docs.ollama.com are the same website.
const sameSite = (host, site) => host === site || host.endsWith(`.${site}`) || site.endsWith(`.${host}`);
const withoutSlash = url => url.replace(/\/+$/, '');

function kindOf(anchor, site) {
  let url;
  try {
    url = new URL(anchor.url);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'github.com' && /^\/[^/]+\/[^/]+\/?$/.test(url.pathname)) return 'GitHub';
  if (host === 'discord.gg' || host === 'discord.com') return 'Community';
  if (!sameSite(host, site) || FILE.test(url.pathname)) return null;
  const words = `${anchor.text} ${url.pathname.replace(/[/_.-]+/g, ' ')}`.toLowerCase();
  if (NOT_USEFUL.test(words) && !/\bsign ?up\b/.test(words)) return null;
  return LINK_KINDS.find(([, test]) => test.test(words))?.[0] ?? null;
}

// One link of each kind: [{ label: 'Docs', url }].
export function importantLinks(anchors, pageUrl) {
  const site = hostOf(pageUrl);
  const found = new Map();
  for (const anchor of anchors) {
    if (withoutSlash(anchor.url) === withoutSlash(pageUrl)) continue;
    const kind = kindOf(anchor, site);
    if (kind && !found.has(kind)) found.set(kind, { label: kind, url: anchor.url });
  }
  return [...found.values()];
}

// The page itself, plus `extra`: the useful pages of the same website.
// Extra pages are only read for a website's front page (ollama.com, notion.so/product), not for an article deep inside it.
export async function readSite(url, { extraPages = true } = {}) {
  const page = await readPage(url);
  const { anchors = [], ...rest } = page;
  const pageUrl = page.finalUrl || url;
  const links = importantLinks(anchors, pageUrl);
  const extra = [];

  const shallow = new URL(pageUrl).pathname.split('/').filter(Boolean).length <= 1;
  if (extraPages && page.ok && shallow) {
    const site = hostOf(pageUrl);
    const picks = WORTH_READING.map(kind => links.find(link => link.label === kind))
      .filter(link => link && sameSite(hostOf(link.url), site))
      .slice(0, MAX_EXTRA_PAGES);
    const pages = await Promise.all(picks.map(link => readPage(link.url, { timeout: 10_000 }).catch(() => null)));
    pages.forEach((other, i) => {
      if (!other?.ok || !other.text || withoutSlash(other.finalUrl) === withoutSlash(pageUrl)) return;
      extra.push({
        url: other.finalUrl,
        label: picks[i].label,
        title: other.title || picks[i].label,
        headings: other.headings ?? [],
        text: other.text.slice(0, EXTRA_PAGE_TEXT),
      });
    });
  }
  return { ...rest, links, extra };
}
