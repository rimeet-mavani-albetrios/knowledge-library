// The pieces of the "Pick links to compare" window (ComparePicker.jsx): a link's row with its tick box, a recent
// comparison's line, and "Your picks" with its 4 places and the Compare button.
// Inside a <dialog>, so every "show this or nothing" is written `cond ? (…) : null`, never `cond && …`.
import { memo, useId, useRef } from 'react';
import { ArrowRight, Check, LoaderCircle, X } from 'lucide-react';
import { categoryStyle, hueOf } from '../categories.jsx';
import { PRICING_LABELS, siteOf, timeAgo } from '../format.js';
import { MAX_COMPARE, MIN_COMPARE } from '../compare.js';
import { SiteIcon } from './LinkCard.jsx';

// A group of rows under a small heading that stays in view while its rows scroll under it.
export function Section({ title, children }) {
  const id = useId();
  return (
    <section className="picker-section" aria-labelledby={id}>
      <h3 id={id} className="picker-heading">
        {title}
      </h3>
      {children}
    </section>
  );
}

// One link: click anywhere on it (or Space / Enter) to tick it or take the tick off. With 4 picked, the others are
// greyed out and can't be ticked: nothing pops up, the "4 is the most" line in Your picks says why.
// Each row only re-draws when its own tick (or lock) changes.
// A grey row the size of a link's row, holding a place while links load, so the rows under it don't move later.
export function PickRowSkeleton() {
  return (
    <div className="picker-row is-skeleton" aria-hidden="true">
      <span className="skeleton picker-icon" />
      <span className="picker-text">
        <span className="skeleton skeleton-text" />
        <span className="skeleton skeleton-text short" />
      </span>
    </div>
  );
}

export const PickRow = memo(function PickRow({ link, ticked, locked, onToggle }) {
  const price = PRICING_LABELS[link.pricing];
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ticked}
      aria-disabled={locked || undefined}
      data-row=""
      className={`picker-row${ticked ? ' is-on' : ''}${locked ? ' is-locked' : ''}`}
      style={hueOf(link.category)}
      onClick={() => {
        if (!locked) onToggle(link);
      }}
    >
      <SiteIcon link={link} className="row-icon picker-icon" />
      <span className="picker-text">
        <span className="picker-name">{link.title}</span>
        <span className="picker-meta">
          <span className="picker-cat">{categoryStyle(link.category).short}</span>
          <span className="picker-site">{siteOf(link)}</span>
          {price ? <span className="picker-price">{price}</span> : null}
        </span>
      </span>
      <span className="picker-box" aria-hidden="true">
        {ticked ? <Check size={14} strokeWidth={3} /> : null}
      </span>
    </button>
  );
});

// "FigJam vs Miro vs tldraw"
const namesOf = item => item.links.map(link => link.title || 'Untitled').join(' vs ');

// A comparison you opened before: one click opens it again, straight away.
export function RecentRow({ item, onOpen }) {
  const names = namesOf(item);
  const when = `${item.links.length} links · ${timeAgo(item.at)}`;
  return (
    <button type="button" data-row="" className="picker-row picker-recent" aria-label={`Compare ${names}, ${when}`} onClick={() => onOpen(item.ids)}>
      {/* The links' icons, overlapping a little, like a small stack of cards. */}
      <span className="picker-recent-icons" aria-hidden="true">
        {item.links.map(link => (
          <span key={link.id} className="picker-recent-icon" style={hueOf(link.category)}>
            <SiteIcon link={link} className="row-icon" />
          </span>
        ))}
      </span>
      <span className="picker-text">
        <span className="picker-name">{names}</span>
        <span className="picker-meta">{when}</span>
      </span>
      <ArrowRight size={16} className="picker-recent-go" aria-hidden="true" />
    </button>
  );
}

// The button's words: phones have no room for the hint line, so with fewer than 2 the button says what's missing.
function goLabel({ edit, count, phone }) {
  if (count < MIN_COMPARE && phone) return 'Pick at least 2';
  if (edit) return 'Update compare';
  return count >= MIN_COMPARE ? `Compare ${count}` : 'Compare';
}

// "Your picks": 4 places (empty ones are dashed), × to take one out, Clear, and the big button.
// On a computer it's the column at the right; on a phone a bar at the bottom of the sheet (compare-picker.css).
// `picked` are link objects (a link whose name is still loading has no title yet). onGo() compares them (or, in
// 'edit', updates the compare window). `onLeave` gets the focus back to the search box when the last pick goes.
export function PicksPanel({ picked, edit, phone, busy, loadingNames, onRemove, onClear, onGo, onLeave }) {
  const list = useRef(null);
  const count = picked.length;
  const ready = count >= MIN_COMPARE;
  const slots = Array.from({ length: MAX_COMPARE }, (_, i) => picked[i] ?? null);
  let note = '';
  if (!ready) note = 'Pick at least 2';
  else if (count >= MAX_COMPARE) note = '4 is the most.';

  // The × goes with its link, so the focus moves to the next ×, or back to the search box, instead of getting lost.
  const removeAt = (id, i) => {
    onRemove(id);
    setTimeout(() => {
      const buttons = list.current?.querySelectorAll('.picker-slot-x') ?? [];
      const next = buttons[Math.min(i, buttons.length - 1)];
      if (next) next.focus();
      else onLeave();
    }, 0);
  };

  return (
    <aside className="picker-picks" aria-label="Your picks">
      <div className="picker-picks-head">
        <h3 className="picker-picks-title">Your picks</h3>
        <span className="picker-picks-count">
          {count} of {MAX_COMPARE}
        </span>
        {count > 0 ? (
          <button
            type="button"
            className="picker-clear"
            onClick={() => {
              onClear();
              onLeave();
            }}
            title="Take all the links out"
          >
            Clear
          </button>
        ) : null}
      </div>
      <ol ref={list} className="picker-slots" aria-label={`${count} of ${MAX_COMPARE} picked`}>
        {slots.map((link, i) =>
          link ? (
            <li key={link.id} className="picker-slot" style={hueOf(link.category)}>
              <SiteIcon link={link} className="row-icon picker-slot-icon" />
              <span className="picker-slot-name">
                {link.title ?? (loadingNames ? <span className="skeleton picker-slot-skeleton" aria-label="Loading" /> : 'Link not found')}
              </span>
              <button
                type="button"
                className="picker-slot-x"
                onClick={() => removeAt(link.id, i)}
                aria-label={`Take ${link.title ?? 'this link'} out`}
                title="Take it out"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ) : (
            <li key={`empty-${i}`} className="picker-slot is-empty" aria-hidden="true">
              {i === count ? <span className="picker-slot-empty">Tick a link</span> : null}
            </li>
          ),
        )}
      </ol>
      {/* Read out by screen readers too, as picks come and go. */}
      <p className="picker-note" role="status">
        {note}
      </p>
      <button type="button" className="btn btn-primary picker-go" disabled={!ready || busy} onClick={onGo}>
        {busy ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : null}
        {goLabel({ edit, count, phone })}
      </button>
    </aside>
  );
}
