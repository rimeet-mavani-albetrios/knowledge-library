// The bar above the results. On big screens it stays at the top while you scroll, so you can change the
// category, filters, order or view from anywhere. "All" is pinned at the left and never slides away; the other
// categories slide sideways (‹ › buttons when there are more), and "All categories" opens them all as a grid.
// Filters that are on show as chips in a thin row under the bar, so they stay in view too.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDownAZ, ArrowUpDown, Check, ChevronLeft, ChevronRight, Clock, Flame, Globe, Grid3x3, History, Hourglass,
  LayoutGrid, List, ListChecks, MapIcon, Search, Shapes, Star, X,
} from 'lucide-react';
import { categoryStyle, hueOf } from '../categories.jsx';
import { PHONE, useMediaQuery, VIEWS } from '../hooks.js';
import { GitHubIcon } from './Icons.jsx';
import { Dropdown, Popover } from './Popover.jsx';
import { ActiveFilters, FiltersButton } from './Filters.jsx';
import { usePrefetch } from '../useLinks.js';

// When the mouse rests on a tab this long, its links start loading, so the click shows them at once.
// (Just moving across the tabs doesn't load anything.)
const HOVER_WAIT = 120;

// `short` is what the button says on phones, where there's less room.
const SORTS = [
  { value: 'newest', label: 'Newest first', short: 'Newest', Icon: Clock },
  { value: 'opened', label: 'Recently opened', short: 'Opened', Icon: History },
  { value: 'used', label: 'Most used', short: 'Most used', Icon: Flame },
  { value: 'favorites', label: 'Favorites first', short: 'Favorites', Icon: Star },
  { value: 'oldest', label: 'Oldest first', short: 'Oldest', Icon: Hourglass },
  { value: 'title', label: 'A to Z', short: 'A to Z', Icon: ArrowDownAZ },
  { value: 'stars', label: 'Most GitHub stars', short: 'Stars', Icon: GitHubIcon },
];

// The three ways to show the links. The order is also the order the phone's one button cycles through.
const VIEW_OPTIONS = [
  { value: 'cards', label: 'Cards', Icon: LayoutGrid },
  { value: 'compact', label: 'Compact', Icon: Grid3x3 },
  { value: 'list', label: 'List', Icon: List },
];

// Hover (or keyboard focus) gets a category's links ready before the click. Returns props for a button.
function useReady(onPrefetch) {
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  return value => ({
    onPointerEnter: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onPrefetch(value), HOVER_WAIT);
    },
    onPointerLeave: () => clearTimeout(timer.current),
    onFocus: () => onPrefetch(value),
  });
}

// Moves the focus through a grid of buttons with the arrow keys: ← → one item, ↑ ↓ one row, Home and End.
// Returns true when the key was used. `up` is called for ↑ on the first row (to go back to the find box).
function moveInGrid(event, grid, up) {
  const items = [...grid.querySelectorAll('[role="option"]')];
  const index = items.indexOf(document.activeElement);
  if (index < 0) return false;
  const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const to = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns, Home: 0, End: items.length - 1 }[event.key];
  if (to === undefined) return false;
  event.preventDefault();
  if (to < 0 && event.key === 'ArrowUp') up?.();
  else items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
  return true;
}

// "All categories": every category as a grid, with a find box. `categories` are the ones with links for the
// current search and filters (plus the chosen one, so it can always be turned off here).
function CategoryPicker({ categories, category, total, onChange, onPrefetch }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const button = useRef(null);
  const pop = useRef(null);
  const grid = useRef(null);
  const input = useRef(null);
  const phone = useMediaQuery(PHONE);
  const ready = useReady(onPrefetch);
  // Closing also forgets what was typed in the find box, so it opens showing everything next time.
  const close = useCallback(() => {
    setOpen(false);
    setFind('');
  }, []);
  const needle = find.trim().toLowerCase();
  const matches = ({ value }) => !needle || value.toLowerCase().includes(needle) || categoryStyle(value).short.toLowerCase().includes(needle);
  const shown = categories.filter(item => (item.count > 0 || item.value === category) && matches(item));
  const items = [...(!needle || 'all'.includes(needle) ? [{ value: '', count: total }] : []), ...shown];

  // Opening: on a computer the find box takes the focus, so you can type a name straight away. On a phone that
  // would pop the keyboard over the sheet, so the chosen category (or the first) gets it instead.
  useEffect(() => {
    if (!open) return;
    const chosen = grid.current?.querySelector('[aria-selected="true"]') ?? grid.current?.querySelector('[role="option"]');
    (phone ? chosen : input.current)?.focus({ preventScroll: true });
  }, [open, phone]);

  const pick = value => {
    close();
    button.current?.focus();
    if (value !== category) onChange(value);
  };

  const onKey = event => {
    if (event.key === 'ArrowDown' && event.target === input.current) {
      event.preventDefault();
      grid.current?.querySelector('[role="option"]')?.focus();
    } else if (grid.current && event.target.getAttribute('role') === 'option') {
      moveInGrid(event, grid.current, () => input.current?.focus());
    }
  };
  // Tab out of the window (past its last item, or back before the find box) closes it, like a menu.
  const onBlur = event => {
    const to = event.relatedTarget;
    if (open && to && !pop.current?.contains(to) && !button.current?.contains(to)) close();
  };

  return (
    <div className="dropdown cat-picker">
      <button
        ref={button}
        type="button"
        className={`tool-btn cat-picker-btn${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="All categories"
        title="All categories"
        onClick={() => setOpen(!open)}
        onBlur={onBlur}
      >
        <Shapes size={16} aria-hidden="true" />
        <span className="tool-label hide-small">All categories</span>
      </button>
      <Popover open={open} onClose={close} anchor={button} label="All categories" role="dialog" className="cat-pop">
        <div ref={pop} className="cat-pop-inner" onKeyDown={onKey} onBlur={onBlur}>
          <label className="cat-find">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Find a category</span>
            <input ref={input} type="search" value={find} onChange={event => setFind(event.target.value)} placeholder="Find a category" autoComplete="off" />
            {find && (
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Clear" onClick={() => setFind('')}>
                <X size={15} />
              </button>
            )}
          </label>
          {items.length ? (
            <div ref={grid} className="cat-grid" role="listbox" aria-label="Categories">
              {items.map(({ value, count }) => {
                const { Icon, short } = value ? categoryStyle(value) : { Icon: Globe, short: 'All' };
                return (
                  <button
                    key={value || '*'}
                    type="button"
                    role="option"
                    className={`cat-item${value ? '' : ' cat-item-all'}`}
                    style={value ? hueOf(value) : undefined}
                    aria-selected={category === value}
                    onClick={() => pick(value)}
                    {...ready(value)}
                  >
                    <span className="cat-item-icon">
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <span className="cat-item-name">{short}</span>
                    <span className="cat-item-count">{count}</span>
                    <Check size={16} aria-hidden="true" className="cat-item-check" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="hint cat-grid-empty">No category has “{find.trim()}” in it.</p>
          )}
        </div>
      </Popover>
    </div>
  );
}

function CategoryTabs({ categories, category, total, onChange, onPrefetch }) {
  const row = useRef(null);
  const ready = useReady(onPrefetch);
  const [more, setMore] = useState({ left: false, right: false }); // is there more to see on each side?
  const measure = useCallback(() => {
    const element = row.current;
    if (!element) return;
    setMore({
      left: element.scrollLeft > 4,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
    });
  }, []);
  // The chosen category slides into view if it's hidden. When the page opens on one, it's simply there.
  const placed = useRef(false); // has the row been laid out and looked at once?
  const reveal = useCallback(() => {
    const element = row.current;
    if (!element?.clientWidth) return; // not laid out yet (a tab in the background, say): the size watcher tries again
    const chosen = element.querySelector('.cat-pick.is-on');
    const smooth = placed.current;
    placed.current = true;
    if (!chosen) return;
    const margin = 44; // room for the ‹ › buttons and the fade
    const left = chosen.offsetLeft - margin;
    const right = chosen.offsetLeft + chosen.offsetWidth + margin - element.clientWidth;
    const to = left < element.scrollLeft ? left : right > element.scrollLeft ? right : null;
    if (to !== null) element.scrollTo({ left: Math.max(0, to), behavior: smooth ? 'smooth' : 'instant' });
  }, []);
  useEffect(reveal, [reveal, category, categories.length]);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(() => {
      measure();
      if (!placed.current) reveal();
    });
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [measure, reveal, categories.length]);
  const slide = direction => row.current.scrollBy({ left: direction * row.current.clientWidth * 0.7, behavior: 'smooth' });
  // The chosen category is shown even when the current search has no links in it, so it can be turned off.
  const shown = category && !categories.some(item => item.value === category) ? [{ value: category, count: 0 }, ...categories] : categories;

  return (
    <div className="cat-tabs">
      <button type="button" className="cat-tab cat-all" aria-pressed={!category} onClick={() => onChange('')} {...ready('')}>
        All <span className="cat-count">{total}</span>
      </button>
      <div className={`cat-scroll${more.left ? ' more-left' : ''}${more.right ? ' more-right' : ''}`}>
        <button type="button" className="cat-arrow left" aria-label="Earlier categories" tabIndex={-1} onClick={() => slide(-1)} hidden={!more.left}>
          <ChevronLeft size={18} />
        </button>
        <div className="cat-row" ref={row} onScroll={measure} role="group" aria-label="Category">
          {shown.map(({ value, count }) => {
            const on = category === value;
            return (
              <span key={value} className={`cat-pick${on ? ' is-on' : ''}`} style={hueOf(value)}>
                <button type="button" className="cat-tab has-hue" aria-pressed={on} onClick={() => onChange(on ? '' : value)} {...ready(on ? '' : value)}>
                  {categoryStyle(value).short} <span className="cat-count">{count}</span>
                </button>
                {on && (
                  <button type="button" className="cat-x" aria-label="Back to all categories" title="Back to all categories" onClick={() => onChange('')} {...ready('')}>
                    <X size={13} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <button type="button" className="cat-arrow right" aria-label="More categories" tabIndex={-1} onClick={() => slide(1)} hidden={!more.right}>
          <ChevronRight size={18} />
        </button>
      </div>
      <CategoryPicker categories={shown} category={category} total={total} onChange={onChange} onPrefetch={onPrefetch} />
    </div>
  );
}

// Is the toolbar stuck to the top bar right now? Then it gets a solid background, so links don't show through.
function useStuck(ref) {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const check = () => {
      const element = ref.current;
      if (!element) return;
      const style = getComputedStyle(element);
      setStuck(style.position === 'sticky' && window.scrollY > 0 && element.getBoundingClientRect().top <= parseFloat(style.top) + 1);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [ref]);
  return stuck;
}

// Tells the CSS how tall the sticky toolbar is (--toolbar-h), so the arrow keys stop scrolling just under it.
// It changes when the row of filter chips comes and goes. On phones the toolbar scrolls away, so it's 0.
function useToolbarHeight(ref) {
  useLayoutEffect(() => {
    const element = ref.current;
    const root = document.documentElement.style;
    const apply = () => {
      const sticky = getComputedStyle(element).position === 'sticky';
      root.setProperty('--toolbar-h', sticky ? `${element.offsetHeight}px` : '0px');
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(element);
    window.addEventListener('resize', apply);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', apply);
      root.removeProperty('--toolbar-h');
    };
  }, [ref]);
}

// `map` is { open, onToggle } when the map hides behind a button (on phones).
export default function Toolbar({ params, setParams, owner, facets, view, onView, selecting, onSelecting, map, onFiltersDone }) {
  const wrap = useRef(null);
  const stuck = useStuck(wrap);
  useToolbarHeight(wrap);
  const prefetch = usePrefetch();
  const viewIndex = Math.max(0, VIEWS.indexOf(view));
  const { Icon: ViewIcon, label: viewLabel } = VIEW_OPTIONS[viewIndex];
  const { value: nextView, label: nextViewLabel } = VIEW_OPTIONS[(viewIndex + 1) % VIEW_OPTIONS.length];
  return (
    <div className={`toolbar-wrap${stuck ? ' is-stuck' : ''}`} ref={wrap}>
      <div className="toolbar" role="toolbar" aria-label="Browse your links">
        <CategoryTabs
          categories={facets.categories}
          category={params.category}
          total={facets.total}
          onChange={category => setParams({ category })}
          onPrefetch={category => prefetch({ ...params, category })}
        />
        <div className="toolbar-tools">
          <FiltersButton params={params} setParams={setParams} data={facets} onDone={onFiltersDone} />
          {/* A search is in best-match order, so there's nothing to sort. */}
          {!params.q && (
            <Dropdown title="Sort by" icon={ArrowUpDown} value={params.sort} options={SORTS} onChange={sort => setParams({ sort })} />
          )}
          {map && (
            <button
              type="button"
              className={`tool-btn${map.open ? ' is-on' : ''}`}
              aria-pressed={map.open}
              onClick={map.onToggle}
              title={params.q ? 'Show the results on the map' : 'Show the map'}
            >
              <MapIcon size={16} aria-hidden="true" />
              <span className="tool-label hide-small">Map</span>
            </button>
          )}
          {owner && (
            <button
              type="button"
              className={`tool-btn${selecting ? ' is-on' : ''}`}
              aria-pressed={selecting}
              aria-label="Select links"
              title="Select links to tag, move, read again or delete many at once"
              onClick={() => onSelecting(!selecting)}
            >
              <ListChecks size={16} aria-hidden="true" />
              <span className="tool-label hide-small">Select</span>
            </button>
          )}
          <div className="segmented view-switch" role="group" aria-label="Show links as">
            {VIEW_OPTIONS.map(({ value, label, Icon }) => (
              <button key={value} type="button" aria-pressed={view === value} aria-label={label} title={label} onClick={() => onView(value)}>
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
          </div>
          {/* Phones: one button that shows the current view; each tap moves on to the next one. */}
          <button
            type="button"
            className="tool-btn view-cycle"
            aria-label={`${viewLabel}. Tap for ${nextViewLabel.toLowerCase()}`}
            title={`${viewLabel}. Tap for ${nextViewLabel.toLowerCase()}`}
            onClick={() => onView(nextView)}
          >
            <ViewIcon size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
      <ActiveFilters params={params} setParams={setParams} owner={owner} />
    </div>
  );
}
