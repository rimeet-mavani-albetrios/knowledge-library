// Finding, cleaning and comparing web addresses.

// Query parameters that only track where a click came from. They never change the page.
const TRACKING_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|ref_src|ref_url)$/i;

// A link in plain text. It ends at a space, a quote, a comma (the next column of a CSV file),
// or where a second "http://" starts. A comma between two numbers stays, like in map links: "@40.7,-73.9".
// The website (web/src/api.js) uses the same rule.
const LINK_IN_TEXT = /https?:\/\/(?:(?!https?:\/\/)(?:[^\s<>"'`,]|(?<=\d),(?=-?\d)))+/gi;

// Finds links in any text: a list, a sentence, a CSV, or a bookmarks file exported from a browser.
export function findUrls(text) {
  text = String(text ?? '');
  const found = /<a\s[^>]*href=/i.test(text)
    ? [...text.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map(match => match[1].replace(/&amp;/g, '&'))
    : (text.match(LINK_IN_TEXT) ?? []).map(url => url.replace(/[.,;:!?)\]}]+$/, ''));
  return found.filter(url => /^https?:\/\//i.test(url));
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
