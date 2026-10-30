// Small pieces every card of the Stats page uses: the card frame with its "plate" number (like the numbered plates
// of an atlas), one row for a link, and words for numbers.
// Only named exports here: a file in this folder with a default export becomes an extra card (see StatsPage.jsx).
import { categoryStyle, hueOf } from '../../categories.jsx';
import { siteOf } from '../../format.js';
import { SiteIcon } from '../LinkCard.jsx';

export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// "12%" (never "0%" for something that is there, never "100%" for something that isn't everything).
export function percent(part, whole) {
  if (!whole || !part) return '0%';
  const value = Math.round((part / whole) * 100);
  return `${part < whole ? Math.min(99, Math.max(1, value)) : value}%`;
}

// A date's own day as "2026-10-28", in the visitor's time (the server counts days the same way).
export const dayKey = date =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// "2026-10-28" → that day at midnight here. (new Date("2026-10-28") would be midnight in London, a day early in America.)
export function dayDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// "28 Oct 2026"
export const dayName = key =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(dayDate(key));

// Scrolling that respects "reduce motion" in the phone's or computer's settings.
export const motion = () => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

// The frame of every card: a small numbered kicker ("01 · Topics"), the title, a line under it, and an optional
// button on the right. The card itself can take the focus, so "jump to" buttons can bring screen readers here too.
export function Card({ id, plate, kicker, title, sub, action, className = '', children }) {
  return (
    <section id={id} className={`stats-card ${className}`} aria-labelledby={`${id}-title`} tabIndex={-1}>
      <header className="stats-card-head">
        <div className="stats-card-titles">
          <p className="stats-kicker" aria-hidden="true">
            {plate ? <span className="stats-plate">{plate}</span> : null}
            {kicker}
          </p>
          <h3 id={`${id}-title`}>{title}</h3>
          {sub ? <p className="stats-card-sub">{sub}</p> : null}
        </div>
        {action ? <div className="stats-card-action">{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

// The category as a small colored word ("Dev tools"), for the end of a link's row.
export function CategoryTag({ name }) {
  const { Icon, short } = categoryStyle(name);
  return (
    <span className="stats-tag" style={hueOf(name)} title={name}>
      <Icon size={13} aria-hidden="true" />
      <span>{short}</span>
    </span>
  );
}

// One link: its site icon (tinted in its category's color), its name, a line under it (the website, unless `sub`
// says something else) and something on the right (`side`). Clicking opens its details on top of the page.
export function LinkRow({ link, sub, side, onOpenLink }) {
  return (
    <li>
      <button type="button" className="stats-link" style={hueOf(link.category)} onClick={() => onOpenLink(link.id)}>
        <SiteIcon link={link} className="row-icon stats-link-icon" />
        <span className="stats-link-text">
          <span className="stats-link-title">{link.title || siteOf(link)}</span>
          <span className="stats-link-sub">{sub ?? siteOf(link)}</span>
        </span>
        {side ? <span className="stats-link-side">{side}</span> : null}
      </button>
    </li>
  );
}

// Grey rows of the same size as LinkRow, while a list loads.
export function LinkRowsLoading({ count = 5 }) {
  return (
    <ul className="stats-links" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="stats-link is-skeleton">
          <span className="stats-link-icon row-icon" />
          <span className="stats-link-text">
            <span className="stats-bone" style={{ width: `${62 - (i % 3) * 12}%` }} />
            <span className="stats-bone is-thin" style={{ width: `${38 - (i % 2) * 10}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
