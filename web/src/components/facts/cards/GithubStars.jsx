// GitHub stars over time: one point a week, drawn as a line. The first point is the day tracking started.
import { Star, TrendingUp } from 'lucide-react';
import { compactNumber, fullDate } from '../../../format.js';

export const tab = 'popularity';
export const order = 10;

// A GitHub project's stars are known before the facts arrive (the list already has them), so this tile never waits.
export function glance(facts, link) {
  if (link?.source !== 'github' || !Number.isFinite(link.github?.stars)) return null;
  return { icon: Star, label: 'GitHub stars', value: compactNumber(link.github.stars), rank: 5, tab: 'popularity' };
}

const W = 560;
const H = 120;
const PAD = 6;

function Line({ points }) {
  const values = points.map(point => point.stars);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const times = points.map(point => Date.parse(point.at));
  const first = times[0];
  const span = Math.max(times.at(-1) - first, 1);
  const x = time => PAD + ((time - first) / span) * (W - PAD * 2);
  const y = value => (max === min ? H / 2 : H - PAD - ((value - min) / (max - min)) * (H - PAD * 2));
  const path = points.map((point, i) => `${i ? 'L' : 'M'}${x(times[i]).toFixed(1)},${y(point.stars).toFixed(1)}`).join(' ');
  return (
    <svg className="stars-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Stars went from ${values[0]} to ${values.at(-1)}`}>
      <path className="stars-area" d={`${path} L${x(times.at(-1)).toFixed(1)},${H} L${x(first).toFixed(1)},${H} Z`} />
      <path className="stars-stroke" d={path} vectorEffect="non-scaling-stroke" />
      {points.map((point, i) => (
        <circle key={point.at} cx={x(times[i])} cy={y(point.stars)} r="3.5" vectorEffect="non-scaling-stroke">
          <title>{`${fullDate(point.at)}: ${point.stars.toLocaleString('en')} stars`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function GithubStars({ link, history }) {
  const points = (history.stars ?? []).filter(point => Number.isFinite(point.stars));
  const now = points.at(-1)?.stars ?? link.github?.stars;
  if (link.source !== 'github' || !Number.isFinite(now)) return null;
  const gain = points.length > 1 ? now - points[0].stars : null;
  return (
    <section className="fact-card">
      <h3 className="fact-card-title">
        <Star size={14} aria-hidden="true" /> GitHub stars
      </h3>
      <p className="stars-now">
        <strong>{now.toLocaleString('en')}</strong> stars
        {gain !== null ? (
          <span className={`stars-gain${gain > 0 ? ' is-up' : ''}`}>
            <TrendingUp size={14} aria-hidden="true" /> {gain >= 0 ? '+' : '−'}
            {compactNumber(Math.abs(gain))} since {fullDate(points[0].at)}
          </span>
        ) : null}
      </p>
      {points.length > 1 ? (
        <Line points={points} />
      ) : (
        <p className="fact-muted">
          {points.length
            ? `Tracking started on ${fullDate(points[0].at)}. A new point is added every week, so the line grows over time.`
            : 'Weekly tracking starts soon. A new point is added every week.'}
        </p>
      )}
    </section>
  );
}
