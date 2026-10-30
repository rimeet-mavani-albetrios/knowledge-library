// "Popular in": how popular the website is in the world and in which countries most, from Cloudflare Radar.
// facts.popularity = { domain, bucket (10000 = "top 10K") | null, rank? (top 100 only), top: [{ country, rank }], rising }.
// Cloudflare only names the countries where a website is in that country's top 100 (at most 5), so big countries
// like India show up only for very big websites. The list says so, and India comes first when it's there.
import { Earth, TrendingUp } from 'lucide-react';
import Flag from '../../Flag.jsx';
import './popularity.css';

export const tab = 'popularity';
export const order = 10;

const SHOWN = 8;
const HOME = 'IN'; // your own country comes first in the list, and is the only one named on the tile
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const SHORT_NAMES = { US: 'USA', GB: 'UK', AE: 'UAE', HK: 'Hong Kong', MO: 'Macao', KR: 'South Korea', CZ: 'Czechia' };
const LONG_NAMES = { HK: 'Hong Kong', MO: 'Macao', PS: 'Palestine' };
const whole = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 });

const countryName = (code, short = false) => {
  if (short && SHORT_NAMES[code]) return SHORT_NAMES[code];
  try {
    return LONG_NAMES[code] ?? regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

// "Top 10K" for a bucket, "#3" for the top 100.
export function rankText(popularity) {
  if (popularity?.rank) return `#${popularity.rank}`;
  if (popularity?.bucket) return `Top ${compact.format(popularity.bucket)}`;
  return '';
}

// For the world map: a bigger number where the website ranks better (rank 1 → 100, rank 1,000 → 1).
export function mapValues(top = []) {
  return Object.fromEntries(top.map(place => [place.country, Math.round((1000 / place.rank) * 10) / 100]));
}

// The countries, your own first; the rest stay in Cloudflare's order (best rank first).
const homeFirst = (top = []) => [...top].sort((a, b) => (b.country === HOME) - (a.country === HOME));

export function glance(facts) {
  const popularity = facts?.popularity;
  const rankLabel = rankText(popularity);
  if (!rankLabel) return null;
  // "Tunisia, Lebanon" on the tile reads like "most visitors come from there", so only India is named.
  const home = (popularity.top ?? []).find(place => place.country === HOME);
  return {
    icon: popularity.rising ? TrendingUp : Earth,
    label: 'Popularity',
    value: rankLabel,
    note: home ? `${countryName(HOME, true)} #${whole.format(home.rank)}` : popularity.rising ? 'Rising' : undefined,
    rank: 10,
    tab,
    tone: popularity.rising ? 'good' : undefined,
  };
}

export default function PopularIn({ facts }) {
  const popularity = facts?.popularity;
  if (!popularity) return null; // not looked up yet, or a page on someone else's website
  const rank = rankText(popularity);
  const top = homeFirst(popularity.top).slice(0, SHOWN);
  const best = Math.min(...top.map(place => place.rank), 100);

  return (
    <section className="fact-card fact-popular">
      <div className="fact-popular-head">
        <h3 className="fact-card-title">
          <Earth size={14} aria-hidden="true" /> Popularity worldwide
        </h3>
        {popularity.rising && (
          <span className="pill fact-rising" title="Cloudflare sees this website climbing fast right now">
            <TrendingUp size={13} aria-hidden="true" /> Rising
          </span>
        )}
      </div>

      {rank ? (
        <p className="fact-popular-world">
          <strong>{rank} website</strong> in the world
        </p>
      ) : (
        <p className="fact-empty">
          Not enough data yet. Cloudflare only ranks websites with lots of visitors, so smaller ones don’t show here.
        </p>
      )}

      {/* A ternary, not `rank && …`: an empty string inside the detail dialog crashes React (see compare-speed notes). */}
      {top.length > 0 ? (
        <p className="fact-countries-note">In the top 100 websites of these countries:</p>
      ) : rank ? (
        <p className="fact-countries-note">Not in the top 100 websites of any country yet.</p>
      ) : null}
      {top.length > 0 && (
        <ol className="fact-countries" aria-label="Countries where it's in the top 100 websites">
          {top.map((place, index) => (
            <li key={place.country}>
              <span className="fact-country-pos">{index + 1}</span>
              <span className="fact-flag">
                <Flag code={place.country.toUpperCase()} />
              </span>
              <span className="fact-country-name">{countryName(place.country)}</span>
              <span className="fact-country-bar" aria-hidden="true">
                <span style={{ width: `${Math.max(6, Math.round((best / place.rank) * 100))}%` }} />
              </span>
              <span className="fact-country-rank" title={`Number ${whole.format(place.rank)} among websites in ${countryName(place.country)}`}>
                #{whole.format(place.rank)}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="fact-source">
        From Cloudflare Radar{popularity.domain ? ` · ${popularity.domain}` : ''}. Cloudflare only names the countries where
        a website is in the top 100, so most websites have none, and India shows only for very big ones.
      </p>
    </section>
  );
}
