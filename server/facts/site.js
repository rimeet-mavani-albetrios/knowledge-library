// What the fact kinds share about a link's website: its host, its "real" domain (notion.so for www.notion.so,
// bbc.co.uk for news.bbc.co.uk) and its home page, read once and kept for a few minutes so several kinds can use it.
import * as cheerio from 'cheerio';
import { safeFetch, USER_AGENT } from '../robot/page.js';

const MAX_HTML = 2_000_000;
const HOME_CACHE_MS = 10 * 60_000;
const HOME_CACHE_SIZE = 30;
const homes = new Map(); // origin → { at, promise }

// Websites where everyone gets their own address (someone.github.io, app.vercel.app). The domain's age or owner
// would describe the platform, not the website you saved.
const PLATFORMS = [
  'github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'herokuapp.com', 'web.app',
  'firebaseapp.com', 'notion.site', 'substack.com', 'medium.com', 'blogspot.com', 'wordpress.com', 'gitbook.io',
  'readthedocs.io', 'webflow.io', 'framer.website', 'framer.ai', 'carrd.co', 'replit.app', 'repl.co', 'streamlit.app',
  'glitch.me', 'onrender.com', 'fly.dev', 'up.railway.app', 'surge.sh', 'wixsite.com', 'squarespace.com', 'tumblr.com',
  'hashnode.dev', 'super.site', 'softr.app', 'bubbleapps.io', 'lovable.app', 'bolt.new', 'hf.space',
];
// Country endings that come in two parts: bbc.co.uk, abc.net.au, gov.in.
const TWO_PART = /\.(co|com|net|org|gov|edu|ac|or|ne|go|gob|nic|ltd|plc)\.[a-z]{2}$/;

export function domainOf(host) {
  const platform = PLATFORMS.find(suffix => host.endsWith(`.${suffix}`));
  const labels = host.split('.');
  if (platform) return { domain: labels.slice(-(platform.split('.').length + 1)).join('.'), platform: true };
  return { domain: labels.slice(TWO_PART.test(host) ? -3 : -2).join('.'), platform: false };
}

// notion.so and notion.com are the same company; legal pages often live on the other one.
export const sameName = (host, domain) => {
  const name = domain.split('.')[0];
  const other = domainOf(host).domain;
  return other === domain || other.split('.')[0] === name;
};

// Any page of a website as { ok, url, html, $ (cheerio), anchors: [{ url, text }] }, or { ok: false, final }.
export async function readHtml(pageUrl) {
  let res, finalUrl;
  try {
    ({ res, finalUrl } = await safeFetch(pageUrl, {
      timeout: 15_000,
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'accept-language': 'en-US,en;q=0.8' },
    }));
  } catch (err) {
    const error = err.code ?? err.cause?.code ?? err.name;
    return { ok: false, error, final: error === 'ENOTFOUND' || error === 'BLOCKED' };
  }
  // `final`: the website is gone or doesn't let robots in, so trying again tomorrow won't help.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) {
    await res.body?.cancel();
    return { ok: false, status: res.status, url: finalUrl, final: res.status < 500 };
  }
  const html = (await res.text()).slice(0, MAX_HTML);
  const $ = cheerio.load(html);
  const anchors = [];
  $('a[href]').each((_, element) => {
    try {
      const url = new URL($(element).attr('href'), finalUrl).href.split('#')[0];
      const text = ($(element).text() || $(element).attr('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (/^https?:/.test(url)) anchors.push({ url, text });
    } catch {
      // a broken address on the page
    }
  });
  return { ok: true, url: finalUrl, html, $, anchors };
}

// The home page, read at most once per 10 minutes per website.
function home(origin) {
  const cached = homes.get(origin);
  if (cached && Date.now() - cached.at < HOME_CACHE_MS) return cached.promise;
  if (homes.size >= HOME_CACHE_SIZE) homes.delete(homes.keys().next().value);
  const promise = readHtml(`${origin}/`);
  homes.set(origin, { at: Date.now(), promise });
  return promise;
}

// The third thing each kind's collect() gets.
export function siteContext(link) {
  const url = new URL(link.url);
  const host = url.hostname.replace(/^www\./, '');
  return { host, ...domainOf(host), origin: url.origin, home: () => home(url.origin) };
}
