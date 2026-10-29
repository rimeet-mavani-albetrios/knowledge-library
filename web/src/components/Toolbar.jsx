// The bar above the results, made like an open folder: the categories are tabs on its top edge and the results
// under the bar are its body. "All links" comes first, then the biggest categories, as many as fit on one line,
// then "N more", which opens every category as a grid with a find box. The chosen category always has a tab.
// The tools (Filters, Sort, Map on phones, Select, Compare, the views) sit together at the right of the tabs.
// On big screens the bar stays at the top while you scroll, so you can change the category, filters, order or view
// from anywhere. Filters that are on show as chips at the top of the folder, so they stay in view too.
// "Compare" opens the "Pick links to compare" window (2 to 4 links side by side); its badge says how many are picked.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ, ArrowUpDown, Check, ChevronDown, Clock, Columns3, Flame, Globe, Grid3x3, History, Hourglass,
  LayoutGrid, List, ListChecks, MapIcon, Search, Star, ThumbsUp, TrendingUp, X,
} from 'lucide-react';
import { categoryStyle, hueOf } from '../categories.jsx';
import { PHONE, useMediaQuery, VIEWS } from '../hooks.js';
import { GitHubIcon } from './Icons.jsx';
import { Dropdown, Popover } from './Popover.jsx';
import { ActiveFilters, FiltersButton } from './Filters.jsx';
import { useQuery } from '@tanstack/react-query';
import { facetsQuery, usePrefetch } from '../useLinks.js';
import { useComparePicks } from '../compare.js';

// When the mouse rests on a tab this long, its links start loading, so the click shows them at once.
// (Just moving across the tabs doesn't load anything.)
const HOVER_WAIT = 120;

// No search and no filters: the whole library, for the tabs' fixed order.
const NOTHING_CHOSEN = {
  q: '', exact: false, category: '', source: '', collection: '', tag: '', level: '', status: '', favorite: false, free: false, broken: false,
  country: '', trust: false,
};

// Phones slide the tabs sideways with a finger, so they get this many of the biggest categories (and "more").
const PHONE_TABS = 8;

// The widest the "more" window gets on a computer (the same as .cat-pop in styles.css).
const POP_WIDTH = 600;

// `short` is what the button says on phones, where there's less room.
const SORTS = [
  { value: 'newest', label: 'Newest first', short: 'Newest', Icon: Clock },
  { value: 'opened', label: 'Recently opened', short: 'Opened', Icon: History },
  { value: 'used', label: 'Most used', short: 'Most used', Icon: Flame },
  { value: 'favorites', label: 'Favorites first', short: 'Favorites', Icon: Star },
  { value: 'oldest', label: 'Oldest first', short: 'Oldest', Icon: Hourglass },
  { value: 'title', label: 'A to Z', short: 'A to Z', Icon: ArrowDownAZ },
  { value: 'stars', label: 'Most GitHub stars', short: 'Stars', Icon: GitHubIcon },
  // From the facts about each website: its popularity bucket and its app's rating. Links without them go last.
  { value: 'popular', label: 'Most popular', short: 'Popular', Icon: TrendingUp },
  { value: 'rated', label: 'Best rated', short: 'Best rated', Icon: ThumbsUp },
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

// What a tab says: the category's color dot and short name. The hidden copy that measures the tabs uses it too,
// so the copy is exactly as wide as the real thing.
function TabFace({ value, label = categoryStyle(value).short }) {
  return (
    <>
      {value && <span className="folder-dot" aria-hidden="true" />}
      <span className="folder-name" data-label={label}>
        {label}
      </span>
    </>
  );
}

// "N more": every category as a grid, with a find box. `categories` are all of the library's categories in their
// fixed order, each with its count for the current search and filters; the ones with none show faded, like their
// tabs (`known` is false until those counts arrive). `more` is how many have no tab.
function CategoryPicker({ categories, category, total, more, known, onChange, onPrefetch }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const [left, setLeft] = useState(0); // where the window starts, from the left end of the tab line
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
  const shown = categories.filter(matches);
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

  // On a computer the window hangs under the tab line with its right side under "more", or from the line's left end
  // when there isn't that much room. (On phones it's a sheet at the bottom of the screen, so this isn't used.)
  // Closing with the button forgets the find box too, like every other way of closing.
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const line = button.current.closest('.toolbar')?.getBoundingClientRect();
    const tab = button.current.getBoundingClientRect();
    if (line) setLeft(Math.max(0, tab.right - line.left - Math.min(POP_WIDTH, line.width)));
    setOpen(true);
  };

  return (
    <div className="dropdown cat-picker" style={{ '--pop-left': `${left}px` }}>
      <button
        ref={button}
        type="button"
        className={`folder-tab folder-more${open ? ' is-open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`All categories, ${more} more`}
        title="All categories"
        onClick={toggle}
        onBlur={onBlur}
      >
        <TabFace label={`${more} more`} />
        <ChevronDown size={15} aria-hidden="true" className="folder-chevron" />
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
                    className={`cat-item${value ? '' : ' cat-item-all'}${value && known && !count ? ' is-empty' : ''}`}
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

// Which categories get a tab on a computer: the biggest ones, as many as fit in the row next to "All links" (and
// "N more" when some are left over). The chosen one always gets a tab: when it's too small to make the cut, it takes
// the last place, so a category picked from "more" shows on the bar. `sizes` are measured by FolderTabs.
function fitTabs(list, sizes, chosen) {
  if (!sizes) return list; // not measured yet: the row cuts off what doesn't fit until it is
  const { room, gap, all, more, widths } = sizes;
  const width = value => (widths[value] ?? 0) + gap;
  let left = room - all;
  if (list.reduce((sum, { value }) => sum + width(value), 0) <= left) return list;
  left -= more + gap + (chosen ? width(chosen) : 0);
  const fits = new Set([chosen]);
  for (const { value } of list) {
    if (value === chosen) continue;
    if (width(value) > left) break; // the next one is too wide: the rest go behind "more", in order
    left -= width(value);
    fits.add(value);
  }
  return list.filter(({ value }) => fits.has(value));
}

// Phones: the biggest few, and the chosen one at the end when it isn't one of them.
function phoneTabs(list, chosen) {
  const top = list.slice(0, PHONE_TABS);
  return top.some(({ value }) => value === chosen) ? top : [...top, ...list.filter(({ value }) => value === chosen)];
}

// The category tabs. On a computer they're as many as fit in the room the tools leave: a hidden copy of every tab is
// measured, and the row's width is watched, so a wider or narrower window shows more or fewer tabs.
// On phones the row slides sideways with a finger instead, and "more" stays at its right end.
function FolderTabs({ categories, library, category, total, onChange, onPrefetch }) {
  const row = useRef(null);
  const ruler = useRef(null);
  const ready = useReady(onPrefetch);
  const phone = useMediaQuery(PHONE);
  const [sizes, setSizes] = useState(null);
  // The tabs keep one order: biggest first in the whole library (`library`), not in the current search or filters,
  // so turning on a filter never shuffles them. Each carries its count for the current search and filters, and a
  // category with none there shows faded in its place. The chosen category is there even when it's empty, so it
  // still shows as the front tab. Until the library's counts arrive, the current ones give the order.
  const known = categories.length > 0; // the current counts have arrived (before that, nothing shows faded)
  const list = useMemo(() => {
    const now = new Map(categories.map(item => [item.value, item.count]));
    const order = (library?.length ? library : categories)
      .filter(item => item.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(({ value }) => ({ value, count: now.get(value) ?? 0 }));
    return category && !order.some(item => item.value === category) ? [...order, { value: category, count: now.get(category) ?? 0 }] : order;
  }, [categories, library, category]);

  const names = list.map(item => item.value).join('\n');
  useLayoutEffect(() => {
    if (phone) return;
    const measure = () => {
      const room = row.current.getBoundingClientRect().width;
      if (!room) return; // not laid out yet (a tab in the background, say): the size watcher tries again
      const width = element => element.getBoundingClientRect().width;
      const [all, more, ...tabs] = ruler.current.children;
      const next = {
        room: room - 1, // a pixel spare, so rounding never pushes the last tab past the end
        gap: parseFloat(getComputedStyle(row.current).columnGap) || 0,
        all: width(all),
        more: width(more),
        widths: Object.fromEntries(tabs.map(tab => [tab.dataset.value, width(tab)])),
      };
      setSizes(current => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    };
    measure();
    // The copy changes size when the fonts arrive; the row, when the window does or the tools change.
    const observer = new ResizeObserver(measure);
    observer.observe(row.current);
    observer.observe(ruler.current);
    return () => observer.disconnect();
  }, [phone, names]);

  // Phones: the chosen tab slides into view when it's off to the side (not hidden under "more").
  useEffect(() => {
    const element = row.current;
    const chosen = element?.querySelector('button.folder-tab[aria-pressed="true"]');
    if (!phone || !chosen) return;
    const box = element.getBoundingClientRect();
    const tab = chosen.getBoundingClientRect();
    const more = element.querySelector('.cat-picker')?.offsetWidth ?? 0;
    if (tab.left < box.left) element.scrollBy({ left: tab.left - box.left - 8 });
    else if (tab.right > box.right - more) element.scrollBy({ left: tab.right - box.right + more + 8 });
  }, [phone, category]);

  // ← → go from tab to tab (Home and End to the first and the last), like in a tab bar.
  const moveBetweenTabs = event => {
    if (!event.target.matches('button.folder-tab')) return; // keys in the "more" window are its own
    const tabs = [...row.current.querySelectorAll('button.folder-tab')];
    const index = tabs.indexOf(event.target);
    const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    tabs[Math.max(0, Math.min(tabs.length - 1, to))].focus();
  };

  const shown = phone ? phoneTabs(list, category) : fitTabs(list, sizes, category);
  const hidden = list.length - shown.length;
  // The chosen tab is the open one: clicking it again changes nothing ("All links" is the way back).
  const tab = (value, label, count) => {
    const on = category === value;
    const empty = Boolean(value) && known && !count && !on;
    return (
      <button
        key={value || '*'}
        type="button"
        className={`folder-tab${empty ? ' is-empty' : ''}`}
        style={value ? hueOf(value) : undefined}
        title={empty ? 'No links here with your search or filters' : undefined}
        aria-pressed={on}
        onClick={on ? undefined : () => onChange(value)}
        {...(on ? {} : ready(value))}
      >
        <TabFace value={value} label={label} />
      </button>
    );
  };

  return (
    <div className="folder-tabs" ref={row} role="group" aria-label="Category" onKeyDown={moveBetweenTabs}>
      {tab('', 'All links')}
      {shown.map(({ value, count }) => tab(value, undefined, count))}
      {hidden > 0 && (
        <CategoryPicker categories={list} category={category} total={total} more={hidden} known={known} onChange={onChange} onPrefetch={onPrefetch} />
      )}
      {/* The hidden copy: "All links", "more" (with the most it could say), then every category. */}
      {!phone && (
        <div className="folder-ruler" aria-hidden="true">
          <div ref={ruler}>
            <span className="folder-tab">
              <TabFace label="All links" />
            </span>
            <span className="folder-tab folder-more">
              <TabFace label={`${list.length} more`} />
              <ChevronDown size={15} className="folder-chevron" />
            </span>
            {list.map(({ value }) => (
              <span key={value} className="folder-tab" style={hueOf(value)} data-value={value}>
                <TabFace value={value} />
              </span>
            ))}
          </div>
        </div>
      )}
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

// The Compare button follows your picks by itself, so a tick re-draws only this button, not the whole toolbar.
function CompareToolButton({ onCompare }) {
  const picked = useComparePicks().length;
  return (
    <button
      type="button"
      className="tool-btn compare-btn"
      aria-haspopup="dialog"
      aria-label={picked ? `Compare, ${picked} picked` : 'Compare'}
      title="Pick 2 to 4 links to compare side by side"
      onClick={onCompare}
    >
      <Columns3 size={16} aria-hidden="true" />
      <span className="tool-label hide-small">Compare</span>
      {picked > 0 && <span className="filters-badge">{picked}</span>}
    </button>
  );
}

// `map` is { open, onToggle } when the map hides behind a button (on phones). onCompare() opens the compare picker.
function Toolbar({
  params, setParams, owner, facets, view, onView, selecting, onSelecting, onCompare, map, onFiltersDone,
}) {
  const wrap = useRef(null);
  const stuck = useStuck(wrap);
  useToolbarHeight(wrap);
  const prefetch = usePrefetch();
  // The whole library's counts (no search, no filters): they give the tabs their fixed order. It's the same
  // question the page asks when nothing is chosen, so it's usually loaded already.
  const library = useQuery({ ...facetsQuery({ ...params, ...NOTHING_CHOSEN }), staleTime: 5 * 60_000 }).data;
  const viewIndex = Math.max(0, VIEWS.indexOf(view));
  const { Icon: ViewIcon, label: viewLabel } = VIEW_OPTIONS[viewIndex];
  const { value: nextView, label: nextViewLabel } = VIEW_OPTIONS[(viewIndex + 1) % VIEW_OPTIONS.length];
  return (
    <div className={`toolbar-wrap${stuck ? ' is-stuck' : ''}`} ref={wrap}>
      <div className="toolbar" role="toolbar" aria-label="Browse your links">
        <FolderTabs
          categories={facets.categories}
          library={library?.categories}
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
          <CompareToolButton onCompare={onCompare} />
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
      {/* The top of the folder's body, joined to the chosen tab. It sticks with the tabs and holds the chips of the
          filters that are on. The results (LinkGrid) carry on the body below it. */}
      <div className="folder-top">
        <ActiveFilters params={params} setParams={setParams} owner={owner} />
      </div>
    </div>
  );
}

// Opening or closing a window doesn't change the toolbar, so it isn't drawn again then.
export default memo(Toolbar);
