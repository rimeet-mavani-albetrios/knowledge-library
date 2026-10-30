// "Popular in": how popular a website is and in which countries, from Cloudflare Radar's free domain ranking.
// Cloudflare gives an exact rank only to the top 100 websites; the others get a bucket ("top 10,000"), and small
// websites get nothing ({ bucket: null, top: [] } → "Not enough data yet"). Needs a free CLOUDFLARE_API_TOKEN that
// can read Radar (Account → Radar → Read).
import { siteDomain } from '../site-domain.js';

const API = 'https://api.cloudflare.com/client/v4/radar/ranking/domain/';
const GAP_MS = 1100; // about one request a second, to be kind to the free API
const MAX_COUNTRIES = 10;

let nextTurn = 0;
// Each request waits for its own slot, even when several links are looked up at once.
async function myTurn() {
  const now = Date.now();
  const at = Math.max(now, nextTurn);
  nextTurn = at + GAP_MS;
  if (at > now) await new Promise(resolve => setTimeout(resolve, at - now));
}

// One ranking of one domain. Null when Cloudflare doesn't know the domain.
async function ranking(domain, rankingType) {
  await myTurn();
  const params = new URLSearchParams({ rankingType, includeTopLocations: 'true', format: 'JSON' });
  const res = await fetch(`${API}${encodeURIComponent(domain)}?${params}`, {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404 || res.status === 400) return null; // not in Cloudflare's lists, or not a domain it ranks
  if (!res.ok) throw new Error(`Cloudflare Radar answered ${res.status} for ${domain}`);
  const body = await res.json();
  if (!body.success) throw new Error(`Cloudflare Radar: ${body.errors?.[0]?.message ?? 'no answer'}`);
  return body.result?.details_0 ?? null;
}

const asNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

export default {
  kind: 'popularity',
  everyDays: 30,
  perRun: 35, // a month's worth of links a day; 1–2 requests each, about a minute a run
  needs: ['CLOUDFLARE_API_TOKEN'],
  sources: ['web'], // a GitHub or YouTube link would get github.com's or youtube.com's rank

  async collect(link) {
    const domain = siteDomain(link);
    if (!domain) return null; // a page on someone else's website: github.com's rank says nothing about a repository
    const popular = await ranking(domain, 'POPULAR');
    const bucket = asNumber(popular?.bucket);
    const rank = asNumber(popular?.rank);
    const top = (popular?.top_locations ?? [])
      .filter(place => /^[A-Z]{2}$/.test(place.locationCode ?? '') && asNumber(place.rank))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_COUNTRIES)
      .map(place => ({ country: place.locationCode, rank: place.rank }));
    if (!bucket && !rank && top.length === 0) return { domain, bucket: null, top: [], rising: false };
    // Only websites that have a ranking can be rising.
    const trending = await ranking(domain, 'TRENDING_RISE');
    return { domain, bucket, ...(rank ? { rank } : {}), top, rising: Boolean(asNumber(trending?.rank)) };
  },

  // A "Rising" moment for the History tab, when a website starts climbing.
  changes(link, oldValue, newValue) {
    if (!newValue?.rising || oldValue?.rising) return [];
    return [{ kind: 'rising', data: { from: oldValue?.bucket ?? null, to: newValue.bucket } }];
  },
};
