// Downloads a web page and pulls out what the library needs: title, description, images, headings, links and main text.
import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 KnowledgeLibraryRobot/2.0';
const MAX_HTML = 2_000_000;
const MAX_TEXT = 12000;

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim();
// Headings found on almost every website. They say nothing about what this one does.
const BOILERPLATE = /^(learn more|read more|see (all|more)|get started|start (now|free)|sign (up|in)|log ?in|contact( us)?|pricing|plans|faq|blog|about( us)?|features|home|menu|newsletter|subscribe|resources|company|products?|solutions|support|legal|follow us|join us|careers)$/i;

// The robot must never be tricked into reading private addresses (the server's own network).
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
  return lower === '::1' || lower === '::' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}

async function assertPublic(url) {
  const { hostname, protocol } = new URL(url);
  if (!/^https?:$/.test(protocol)) throw Object.assign(new Error('Only http and https links can be read'), { code: 'BLOCKED' });
  const host = hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map(entry => entry.address);
  if (addresses.some(isPrivateAddress)) throw Object.assign(new Error('Private addresses are not allowed'), { code: 'BLOCKED' });
}

// fetch() that checks every redirect hop too.
async function safeFetch(url, { timeout = 20_000, ...options } = {}) {
  for (let hop = 0; hop < 6; hop++) {
    await assertPublic(url);
    const res = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    const next = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && next) {
      await res.body?.cancel();
      url = new URL(next, url).href;
      continue;
    }
    return { res, finalUrl: url };
  }
  throw Object.assign(new Error('Too many redirects'), { code: 'REDIRECTS' });
}

// `dead` is true only when the page is surely gone (404/410 or the domain no longer exists).
// A blocked (403) or slow site is not dead: the robot just couldn't read it.
export async function readPage(url, { timeout } = {}) {
  let res, finalUrl;
  try {
    ({ res, finalUrl } = await safeFetch(url, {
      timeout,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.8',
      },
    }));
  } catch (err) {
    const code = err.code ?? err.cause?.code ?? err.name;
    return { ok: false, error: code, dead: code === 'ENOTFOUND' };
  }

  const result = { ok: res.ok, status: res.status, finalUrl, dead: res.status === 404 || res.status === 410 };
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('html')) {
    await res.body?.cancel();
    if (res.ok && type.includes('pdf')) result.title = decodeURIComponent(new URL(finalUrl).pathname.split('/').pop());
    return result;
  }
  const html = (await res.text()).slice(0, MAX_HTML);
  return { ...result, ...parseHtml(html, finalUrl) };
}

// Boxes of a page that a browser shows on their own line. Their text gets a space after it,
// so "Video Editor" and "AI editing" don't become "Video EditorAI editing".
const BLOCKS = 'address, article, aside, blockquote, button, dd, div, dl, dt, figcaption, footer, h1, h2, h3, h4, h5, h6, header, '
  + 'li, main, nav, ol, p, pre, section, summary, table, td, th, tr, ul';

export function parseHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');
  $(BLOCKS).after(' ');
  const meta = (...keys) => {
    for (const key of keys) {
      const value = clean($(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content'));
      if (value) return value;
    }
    return '';
  };
  const absolute = href => {
    try {
      return href ? new URL(href, baseUrl).href : '';
    } catch {
      return '';
    }
  };

  const title = meta('og:title', 'twitter:title') || clean($('title').first().text()) || clean($('h1').first().text());
  const icon =
    $('link[rel="apple-touch-icon"]').first().attr('href') ||
    $('link[rel~="icon"][sizes]').last().attr('href') ||
    $('link[rel~="icon"]').first().attr('href');

  // Read the links before the menus are removed: menus are where "Docs" and "Pricing" usually are.
  const anchors = [];
  $('a[href]').each((_, element) => {
    const url = absolute($(element).attr('href')).split('#')[0];
    const text = clean($(element).text() || $(element).attr('aria-label') || $(element).attr('title')).slice(0, 80);
    if (/^https?:/.test(url) && anchors.length < 400) anchors.push({ url, text });
  });
  const firstHeading = clean($('h1').first().text());

  $('script, style, noscript, svg, template, nav, header, footer, form, iframe, aside').remove();
  // The main part of the page, unless it's tiny (some websites wrap only a small box in <main>).
  const mainText = clean($('main, article, [role="main"]').first().text());
  const text = mainText.length >= 500 ? mainText : clean($('body').text());
  const headings = [firstHeading, ...$('h1, h2, h3').map((_, element) => clean($(element).text())).get()]
    .filter(text => text.length >= 3 && text.length <= 90 && !BOILERPLATE.test(text));

  return {
    title,
    description: meta('og:description', 'description', 'twitter:description'),
    siteName: meta('og:site_name', 'application-name'),
    author: meta('author', 'article:author', 'twitter:creator'),
    image: absolute(meta('og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')),
    icon: absolute(icon) || absolute('/favicon.ico'),
    keywords: meta('keywords').split(',').map(clean).filter(word => word && word.length <= 40).slice(0, 15),
    headings: [...new Set(headings)].slice(0, 25),
    anchors,
    text: text.slice(0, MAX_TEXT),
  };
}

// A light check used by the weekly broken-link scan. Returns true (gone), false (fine) or null (can't tell).
export async function isDead(url) {
  try {
    const { res } = await safeFetch(url, { headers: { 'user-agent': USER_AGENT } });
    await res.body?.cancel();
    if (res.status === 404 || res.status === 410) return true;
    return res.status < 400 ? false : null;
  } catch (err) {
    return (err.code ?? err.cause?.code) === 'ENOTFOUND' ? true : null;
  }
}
