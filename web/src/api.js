// Talking to the server.

// Sent on the window when a change is refused because you're not logged in any more: the login ran out, or you logged
// out in another tab. App.jsx listens and offers to log in again.
export const LOGIN_NEEDED = 'kl-login-needed';

// `signal` lets React Query cancel a request nobody waits for any more (you typed on, so it's an old search).
export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error("Can't reach the library. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && method !== 'GET' && path !== '/login') window.dispatchEvent(new Event(LOGIN_NEEDED));
    throw Object.assign(new Error(data.error ?? `Something went wrong (${res.status}).`), { status: res.status });
  }
  return data;
}

// The filters as query text, e.g. "q=video&category=AI+Tool&free=1".
export function toQuery(params, extra = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...extra })) {
    if (value !== '' && value !== undefined && value !== null && value !== false) search.set(key, value === true ? '1' : value);
  }
  return search.toString();
}

// Same link-finding rules as the server (server/robot/url.js), used to count links while you type.
// No lookbehind in these patterns: a Safari older than 16.4 can't read it, and the whole page would stay blank.
const LINK_IN_TEXT = /(?:https?:\/\/|\bwww\.)(?:(?!https?:\/\/)(?:\d,(?=-?\d)|[^\s<>"'`,]))+/gi;
// "www.remove.bg" with no "https://" in front: it needs a name and an ending after the "www.".
const WWW_LINK = /^www\.(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?:[/?#:]|$)/iu;
// Those characters right before the "www." make it the end of something else: "me@www.x.com", "ftp://www.x.com".
const NOT_BEFORE_WWW = /[\w.@/-]/;
// A line that is nothing but an address with a common ending: "ollama.com".
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

export function findUrls(text) {
  const found = /<a\s[^>]*href=/i.test(text)
    ? [...text.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map(match => match[1].replace(/&amp;/g, '&'))
    : text.split(/\r?\n/).flatMap(line => linksInLine(line));
  return [...new Set(found.filter(url => /^https?:\/\/[^/]/i.test(url)))];
}
