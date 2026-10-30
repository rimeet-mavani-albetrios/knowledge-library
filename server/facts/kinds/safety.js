// Google's safety check: is the website on Google Safe Browsing's lists of phishing, malware or unwanted-software
// sites? Free for personal use with GOOGLE_API_KEY. The Trust grade reads it ({ ok, threats }).
// Links looked up at about the same time go to Google together, up to 500 addresses in one request.

const API = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const MAX_ENTRIES = 500; // Google's limit for one request
const WAIT_MS = 30; // how long a lookup waits for others to join it
const THREAT_TYPES = ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'];

// The saved page and its website's home page: a warning on either one counts.
function addressesOf(url) {
  try {
    const parsed = new URL(url);
    return [...new Set([parsed.href, `${parsed.origin}/`])];
  } catch {
    return [];
  }
}

async function lookUp(urls) {
  const res = await fetch(`${API}?key=${encodeURIComponent(process.env.GOOGLE_API_KEY)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client: { clientId: 'knowledge-library', clientVersion: '1.0' },
      threatInfo: {
        threatTypes: THREAT_TYPES,
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: urls.map(url => ({ url })),
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Safe Browsing answered ${res.status}: ${body.error?.message ?? 'no reason'}`);
  return body.matches ?? []; // Google sends {} when nothing is unsafe
}

let waiting = []; // [{ urls, resolve, reject }]
let timer = null;

async function sendWaiting() {
  timer = null;
  const batch = [];
  let size = 0;
  while (waiting.length && size + waiting[0].urls.length <= MAX_ENTRIES) {
    size += waiting[0].urls.length;
    batch.push(waiting.shift());
  }
  if (waiting.length) timer = setTimeout(sendWaiting, 0);
  try {
    const matches = await lookUp(batch.flatMap(item => item.urls));
    for (const item of batch) {
      const threats = [...new Set(matches.filter(match => item.urls.includes(match.threat?.url)).map(match => match.threatType))];
      item.resolve({ ok: threats.length === 0, threats });
    }
  } catch (err) {
    for (const item of batch) item.reject(err);
  }
}

export default {
  kind: 'safety',
  everyDays: 7,
  perRun: 250,
  needs: ['GOOGLE_API_KEY'],

  collect(link) {
    const urls = addressesOf(link.url);
    if (!urls.length) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      waiting.push({ urls, resolve, reject });
      const size = waiting.reduce((sum, item) => sum + item.urls.length, 0);
      if (size >= MAX_ENTRIES) {
        clearTimeout(timer);
        sendWaiting();
      } else {
        timer ??= setTimeout(sendWaiting, WAIT_MS);
      }
    });
  },
};
