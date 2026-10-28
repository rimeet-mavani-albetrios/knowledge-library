// Talking to the server.

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
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Something went wrong (${res.status}).`), { status: res.status });
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

// Same link-finding rules as the server, used to count links while you type.
export function findUrls(text) {
  const found = /<a\s[^>]*href=/i.test(text)
    ? [...text.matchAll(/<a\s[^>]*?href\s*=\s*["']([^"']+)["']/gi)].map(match => match[1].replace(/&amp;/g, '&'))
    : (text.match(/https?:\/\/(?:(?!https?:\/\/)(?:[^\s<>"'`,]|(?<=\d),(?=-?\d)))+/gi) ?? []).map(url => url.replace(/[.,;:!?)\]}]+$/, ''));
  return [...new Set(found.filter(url => /^https?:\/\//i.test(url)))];
}
