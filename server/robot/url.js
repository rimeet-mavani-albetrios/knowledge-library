// Finding, cleaning and comparing web addresses.

// Query parameters that only track where a click came from. They never change the page.
const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref_src|ref_url)$/i;

// A link in plain text. It starts with "http://", "https://" or "www.", and ends at a space, a quote, a comma (the
// next column of a CSV file), or where a second "http://" starts. A comma between two numbers stays, like in map
// links: "@40.7,-73.9". The website (web/src/api.js) uses the same rule, so what it counts is what gets added.
const LINK_IN_TEXT = /(?:https?:\/\/|\bwww\.)(?:(?!https?:\/\/)(?:\d,(?=-?\d)|[^\s<>"'`,]))+/gi;
// "www.remove.bg" with no "https://" in front: it needs a name and an ending after the "www.".
const WWW_LINK = /^www\.(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?:[/?#:]|$)/iu;
// Those characters right before the "www." make it the end of something else: "me@www.x.com", "ftp://www.x.com".
const NOT_BEFORE_WWW = /[\w.@/-]/;
// A line that is nothing but an address with a common ending: "ollama.com". Inside a sentence a word like that could
// be anything ("node.js", "e.g."), so it only counts as a whole line. The list before adding can take out a wrong one.
const BARE_LINK = /^(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|co|app|dev|in|me|xyz|tech|tools)(?:[/?#]\S*)?$/i;
const OPENING = { ')': '(', ']': '[', '}': '{' };

// What only follows the link in a sentence comes off: a full stop, or a closing bracket whose opening bracket isn't
// in the link. So "(see https://x.com/a)." loses both, and "https://x.com/Python_(language)" keeps its bracket.
function trimLink(link) {
  for (;;) {
    const last = link.slice(-1);
    const opening = OPENING[last];
    const keep = opening ? link.split(opening).length >= link.split(last).length : !/[.,;:!?]/.test(last);
    if (keep) return link;
    link = link.slice(0, -1);
  }
}

function linksInLine(line) {
  const whole = trimLink(line.trim());
  if (BARE_LINK.test(whole)) return [`https://${whole}`];
  return [...line.matchAll(LINK_IN_TEXT)].flatMap(match => {
    const link = trimLink(match[0]);
    if (!/^www\./i.test(link)) return [link];
    return WWW_LINK.test(link) && !NOT_BEFORE_WWW.test(line[match.index - 1] ?? '') ? [`https://${link}`] : [];
  });
}

// Finds links in any text: a list, a sentence, a CSV, or a bookmarks file exported from a browser.
export function findUrls(text) {
  text = String(text ?? '');
  const found = /<a\s[^>]*href=/i.test(text)
    ? [...text.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map(match => match[1].replace(/&amp;/g, '&'))
    : text.split(/\r?\n/).flatMap(line => linksInLine(line));
  return found.filter(url => /^https?:\/\/[^/]/i.test(url));
}

// Repairs an address saved by an older version that kept the CSV's next column: "https://klap.app/,AI" → "https://klap.app/".
export function repairUrl(url) {
  return findUrls(url)[0] ?? url;
}

function parse(input) {
  try {
    const url = new URL(String(input).trim());
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

// The link as we store it: the same page, minus tracking junk.
export function cleanUrl(input) {
  const url = parse(input);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  return url.href;
}

// A "fingerprint" of the address used to catch duplicates: http/https, www., trailing slashes,
// #anchors, tracking codes and GitHub letter case all count as the same link.
export function urlKey(input) {
  const url = parse(cleanUrl(input));
  if (!url) return null;
  url.protocol = 'https:';
  url.hostname = url.hostname.replace(/^www\./, '');
  url.hash = '';
  url.searchParams.sort();
  let pathname = url.pathname.replace(/\/+$/, '');
  if (url.hostname === 'github.com') pathname = pathname.toLowerCase().replace(/\.git$/, '');
  url.pathname = pathname || '/';
  return url.href.replace(/\/$/, '');
}

export function hostOf(input) {
  return parse(input)?.hostname.replace(/^www\./, '') ?? '';
}

export function prettyUrl(input) {
  const url = parse(input);
  if (!url) return String(input);
  return (url.hostname.replace(/^www\./, '') + url.pathname).replace(/\/$/, '');
}

export function sourceOf(input) {
  const host = hostOf(input);
  if (host === 'github.com') return 'github';
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return 'youtube';
  return 'web';
}
