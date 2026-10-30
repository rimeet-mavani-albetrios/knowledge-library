// Two small "gauge" cards of the Stats page:
// - Health: a ring of your links that work, may be broken, or haven't been read yet. "May be broken" opens those links.
// - Price mix: one bar split into Free, Open source, Free plan, Paid and Not known, with a button for the free ones.
import { PRICING_LABELS, timeAgo } from '../../format.js';
import { MoreLink } from '../SeeMore.jsx';
import { Card, percent, plural } from './shared.jsx';
import './gauges.css';

// ---------- Health ----------

const RING = { size: 148, radius: 60, stroke: 16 };
const CIRCLE = 2 * Math.PI * RING.radius;
const GAP = 2.5; // the small space between two parts of the ring
const MIN_PART = 3; // a part that exists is never thinner than this, so 1 broken link out of 5,000 still shows

// The ring's parts as arcs: { key, length, start } along the circle, in the order given.
function arcs(parts, total) {
  const shown = parts.filter(part => part.count > 0);
  const gaps = shown.length > 1 ? GAP * shown.length : 0;
  let start = 0;
  return shown.map(part => {
    const length = Math.max(MIN_PART, (part.count / total) * (CIRCLE - gaps));
    const arc = { ...part, length, start };
    start += length + (shown.length > 1 ? GAP : 0);
    return arc;
  });
}

export function Health({ health, total, plate, onShow }) {
  const { working, broken, unread, lastCheck } = health;
  const showBroken = () => onShow({ broken: true });
  const parts = [
    { key: 'working', count: working, label: 'Work fine', hint: 'Opened fine when last read' },
    { key: 'broken', count: broken, label: 'May be broken', hint: 'Didn’t open last time', onClick: broken ? showBroken : null },
    { key: 'unread', count: unread, label: 'Not checked yet', hint: 'Waiting for the robot' },
  ];
  const share = total ? percent(working, total) : '–';
  const { size, radius, stroke } = RING;
  const middle = size / 2;

  return (
    <Card
      id="stats-health"
      plate={plate}
      kicker="Health"
      title="Do your links still open?"
      sub="The robot opens each page when it reads it, and checks them all again every week."
      className="stats-health"
    >
      <div className="gauge-health">
        <div className="health-ring">
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
            <circle cx={middle} cy={middle} r={radius} className="health-track" strokeWidth={stroke} />
            {total
              ? arcs(parts, total).map(arc => (
                  <circle
                    key={arc.key}
                    cx={middle}
                    cy={middle}
                    r={radius}
                    strokeWidth={stroke}
                    className={`health-arc is-${arc.key}${arc.onClick ? ' is-clickable' : ''}`}
                    strokeDasharray={`${arc.length} ${CIRCLE - arc.length}`}
                    strokeDashoffset={-arc.start}
                    transform={`rotate(-90 ${middle} ${middle})`}
                    onClick={arc.onClick ?? undefined}
                  />
                ))
              : null}
          </svg>
          <span className="health-middle" aria-hidden="true">
            <span className="health-share">{share}</span>
            <span className="health-word">open fine</span>
          </span>
        </div>
        <ul className="gauge-legend" aria-label="Your links by health">
          {parts.map(part => {
            const inside = (
              <>
                <i className={`gauge-dot is-${part.key}`} aria-hidden="true" />
                <span className="gauge-legend-text">
                  <span className="gauge-legend-label">{part.label}</span>
                  <span className="gauge-legend-hint">{part.hint}</span>
                </span>
                <span className="gauge-legend-count">{part.count.toLocaleString()}</span>
              </>
            );
            return (
              <li key={part.key} className={part.count ? '' : 'is-none'}>
                {part.onClick ? (
                  <button type="button" className="gauge-legend-row is-button" onClick={part.onClick} title="Show them in the library">
                    {inside}
                  </button>
                ) : (
                  <div className="gauge-legend-row">{inside}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="stats-note">
        {lastCheck
          ? `Last weekly check ${timeAgo(lastCheck)}.`
          : 'The first weekly check hasn’t run yet: these come from when each page was first read.'}
      </p>
    </Card>
  );
}

// ---------- Price mix ----------

// The order of the bar: the free kinds first, then paid, then the ones nobody knows yet.
const PRICE_ORDER = ['free', 'open-source', 'freemium', 'paid', 'unknown'];
const PRICE_WORDS = { ...PRICING_LABELS, unknown: 'Not known' };
const FREE_KINDS = ['free', 'open-source', 'freemium']; // what the library's "Free" filter shows

export function PriceMix({ pricing, total, plate, onShow }) {
  const counts = Object.fromEntries(pricing.map(({ value, count }) => [value, count]));
  const parts = PRICE_ORDER.map(value => ({ value, count: counts[value] ?? 0 }));
  const free = FREE_KINDS.reduce((sum, value) => sum + (counts[value] ?? 0), 0);

  return (
    <Card
      id="stats-prices"
      plate={plate}
      kicker="Prices"
      title="What they cost"
      sub="From each website’s own pricing, as the robot read it."
      className="stats-prices"
    >
      {total ? (
        <p className="price-head">
          <span className="price-big">{percent(free, total)}</span>
          <span className="price-words">
            can be used for free
            <span className="price-small">
              {plural(free, 'link')}: free, open source or with a free plan
            </span>
          </span>
        </p>
      ) : (
        <p className="stats-calm price-none">No links yet. Their prices show up here.</p>
      )}
      <div className="price-bar" role="img" aria-label={parts.map(part => `${PRICE_WORDS[part.value]}: ${part.count}`).join(', ')}>
        {parts
          .filter(part => part.count)
          .map(part => (
            <span
              key={part.value}
              className={`price-part is-${part.value}`}
              style={{ flexGrow: part.count }}
              title={`${PRICE_WORDS[part.value]}: ${plural(part.count, 'link')} (${percent(part.count, total)})`}
            />
          ))}
      </div>
      <ul className="price-legend">
        {parts.map(part => (
          <li key={part.value} className={part.count ? '' : 'is-none'}>
            <i className={`price-swatch is-${part.value}`} aria-hidden="true" />
            <span className="price-legend-name">{PRICE_WORDS[part.value]}</span>
            <span className="price-legend-count">{part.count.toLocaleString()}</span>
            <span className="price-legend-share">{percent(part.count, total)}</span>
          </li>
        ))}
      </ul>
      {free ? (
        <MoreLink onClick={() => onShow({ free: true })} className="price-show">
          Show the {plural(free, 'free one')}
        </MoreLink>
      ) : null}
    </Card>
  );
}
