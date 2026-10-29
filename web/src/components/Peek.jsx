// The hover peek: rest the mouse on a card, row or tile and a small panel shows the link's picture, summary,
// what it's for and its tags, with Open and Details buttons, so you can look without clicking.
// Only one panel exists. Its state lives in this module, outside React: an item only calls into it from its
// pointer events, and only the panel (PeekLayer, rendered once by LinkGrid) listens, so showing or hiding
// the peek never re-renders the thousand items under it.
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Star } from 'lucide-react';
import { CategoryBadge, hueOf } from '../categories.jsx';
import { Preview, OpenButton } from './LinkCard.jsx';
import { compactNumber, fullDate, fullDateTime, siteOf, PRICING_LABELS, LEVEL_LABELS, isWorking } from '../format.js';
import './peek.css';

const SHOW_WAIT = 450; // the mouse has to rest this long before the panel shows
const SWITCH_WAIT = 220; // with a panel just shown, the next item's panel comes sooner
const GRACE = 120; // time to move the mouse from the item into the panel
const WIDTH = 320;

// Mouse or trackpad only: on a touch screen there is no hover, and a finger would only get a panel in the way.
const canPeek = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------- The store ----------

let state = null; // { id, link, anchor, x, owner, onOpen } while a panel shows
let showTimer = 0;
let hideTimer = 0;
let hiddenAt = 0;
const listeners = new Set();

function set(next) {
  state = next;
  for (const listener of listeners) listener();
}

const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function hidePeek() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!state) return;
  hiddenAt = Date.now();
  set(null);
}

// The mouse came to rest on an item: show its panel after a wait. The panel already showing stays until then,
// so moving along a line of tiles feels like one panel following the mouse.
function schedule(anchor, x, latest) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (state?.id === latest.current.link.id) return; // back from the panel onto the same item: keep it
  const warm = state || Date.now() - hiddenAt < 300;
  showTimer = setTimeout(() => {
    const { link, owner, onOpen } = latest.current;
    if (!anchor.isConnected) return;
    set({ id: link.id, link, anchor, x, owner, onOpen });
  }, warm ? SWITCH_WAIT : SHOW_WAIT);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hidePeek, GRACE);
}

// The mouse left an item: a panel that hadn't shown yet is forgotten; one that shows gets a moment of grace.
function leave() {
  clearTimeout(showTimer);
  if (state) scheduleHide();
}

const NO_HANDLERS = {};

// Pointer handlers for a card, row or tile's <article>. Nothing while you're selecting links: a panel popping
// up between ticks would only get in the way.
export function usePeek(link, { owner, onOpen, selectable = false }) {
  // The panel reads the newest copy of the link and handlers when it opens, without new handlers every render.
  const latest = useRef(null);
  latest.current = { link, owner, onOpen };

  // The link changed while its panel shows (say, you starred it): the panel shows the new copy.
  useEffect(() => {
    if (state?.id === link.id && state.link !== link) set({ ...state, link });
  }, [link]);

  // The item went away (another search, another view): its panel goes with it.
  useEffect(() => () => {
    if (state?.id === link.id) hidePeek();
  }, [link.id]);

  if (selectable) return NO_HANDLERS;
  return {
    onPointerEnter: event => {
      if (event.pointerType === 'touch' || !canPeek()) return;
      schedule(event.currentTarget, event.clientX, latest);
    },
    onPointerLeave: leave,
    // A click opens the details (or the website): a panel arriving over them a moment later would be odd.
    onPointerDown: () => clearTimeout(showTimer),
  };
}

// ---------- Placing the panel ----------

// Where the panel goes: right of the item, else left of it, else under it, else above it; always fully on screen.
// Under a wide item (a list row) it appears near the mouse, not at the far left edge of the row. When nothing
// fits around the item (a short window), it goes beside the mouse, so the item stays under the pointer.
export function placePeek(rect, width, height, pointerX, viewW, viewH, gap = 10, pad = 12) {
  const clampX = left => Math.min(Math.max(left, pad), Math.max(pad, viewW - pad - width));
  const clampY = top => Math.min(Math.max(top, pad), Math.max(pad, viewH - pad - height));
  if (rect.right + gap + width <= viewW - pad) return { side: 'right', left: rect.right + gap, top: clampY(rect.top) };
  if (rect.left - gap - width >= pad) return { side: 'left', left: rect.left - gap - width, top: clampY(rect.top) };
  const left = clampX(rect.width > 480 ? pointerX - 32 : rect.left);
  if (rect.bottom + gap + height <= viewH - pad) return { side: 'below', left, top: rect.bottom + gap };
  if (rect.top - gap - height >= pad) return { side: 'above', left, top: rect.top - gap - height };
  const top = clampY(rect.top);
  if (pointerX + 2 * gap + width <= viewW - pad) return { side: 'right', left: pointerX + 2 * gap, top };
  return { side: 'left', left: clampX(pointerX - 2 * gap - width), top };
}

// ---------- The panel ----------

function PeekPanel({ link, anchor, x, owner, onOpen }) {
  const ref = useRef(null);
  const working = isWorking(link);
  const pricing = PRICING_LABELS[link.pricing];
  const level = LEVEL_LABELS[link.level];
  const tasks = link.useFor ? [] : link.tasks.slice(0, 3);
  const tags = link.tags.slice(0, 6);

  // Placed before the first paint, so it never shows up in the wrong corner for a frame.
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!anchor.isConnected) return hidePeek();
    const place = placePeek(anchor.getBoundingClientRect(), panel.offsetWidth, panel.offsetHeight, x, window.innerWidth, window.innerHeight);
    panel.style.left = `${place.left}px`;
    panel.style.top = `${place.top}px`;
    panel.dataset.side = place.side;
  }, [anchor, x, link]);

  return (
    <aside
      ref={ref}
      className="peek"
      style={{ ...hueOf(link.category), width: WIDTH }}
      aria-label={`Preview of ${link.title}`}
      onPointerEnter={() => clearTimeout(hideTimer)}
      onPointerLeave={scheduleHide}
    >
      <Preview link={link} />
      <div className="peek-body">
        <div className="peek-meta">
          <CategoryBadge name={link.category} />
          {pricing && !working && <span className="pill">{pricing}</span>}
          {level && <span className="pill">{level}</span>}
        </div>
        <h3 className="peek-title">{link.title}</h3>
        <p className="peek-host">
          {link.favorite && (
            <span className="peek-star" title="A favorite">
              <Star size={13} aria-hidden="true" />
              <span className="sr-only">A favorite.</span>
            </span>
          )}
          {siteOf(link)}
          {link.github && (
            <span className="peek-stars">
              <Star size={12} aria-hidden="true" /> {compactNumber(link.github.stars)}
              {link.github.language ? ` · ${link.github.language}` : ''}
            </span>
          )}
        </p>
        {(link.summary || link.description) && <p className="peek-summary">{link.summary || link.description}</p>}
        {(link.useFor || tasks.length > 0) && (
          <div className="peek-use">
            <h4>Use it for</h4>
            {link.useFor ? (
              <p>{link.useFor}</p>
            ) : (
              <ul>
                {tasks.map(task => (
                  <li key={task}>{task}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {tags.length > 0 && (
          <ul className="peek-tags" aria-label="Tags">
            {tags.map(tag => (
              <li key={tag}>#{tag}</li>
            ))}
            {link.tags.length > tags.length && <li className="more">+{link.tags.length - tags.length}</li>}
          </ul>
        )}
        {link.createdAt && (
          <p className="peek-date">
            Added <time dateTime={link.createdAt} title={fullDateTime(link.createdAt)}>{fullDate(link.createdAt)}</time>
          </p>
        )}
      </div>
      <footer className="peek-foot">
        <OpenButton link={link} owner={owner} label="Open website" className="btn btn-primary" onClick={hidePeek} />
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            hidePeek();
            onOpen(link.id);
          }}
        >
          Details
        </button>
      </footer>
    </aside>
  );
}

// Rendered once by LinkGrid. `active` is false while you're selecting links: any open panel goes away.
export function PeekLayer({ active = true }) {
  const peek = useSyncExternalStore(subscribe, () => state);
  const open = Boolean(peek);

  useEffect(() => {
    if (!active) hidePeek();
  }, [active]);

  // While a panel shows: scrolling, Esc, a click anywhere else, or leaving the window closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = event => event.key === 'Escape' && hidePeek();
    const onDown = event => !event.target.closest?.('.peek') && hidePeek();
    window.addEventListener('scroll', hidePeek, { capture: true, passive: true });
    window.addEventListener('resize', hidePeek);
    window.addEventListener('blur', hidePeek);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', hidePeek, { capture: true });
      window.removeEventListener('resize', hidePeek);
      window.removeEventListener('blur', hidePeek);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  if (!peek) return null;
  // A new key per link: the next link's panel is a fresh one (it fades in at its own place).
  return createPortal(<PeekPanel key={peek.id} {...peek} />, document.body);
}
