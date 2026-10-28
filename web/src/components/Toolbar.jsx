// The bar above the results. On big screens it stays at the top while you scroll, so you can change the
// category, filters, order or view from anywhere. Categories slide sideways, with ‹ › buttons when there are more.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowDownAZ, ArrowUpDown, ChevronLeft, ChevronRight, Clock, Flame, History, Hourglass, LayoutGrid, List, ListChecks,
  MapIcon, Star,
} from 'lucide-react';
import { categoryStyle, hueOf } from '../categories.jsx';
import { GitHubIcon } from './Icons.jsx';
import { Dropdown } from './Popover.jsx';
import { FiltersButton } from './Filters.jsx';
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

function CategoryTabs({ categories, category, onChange, onPrefetch }) {
  const row = useRef(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Hover (or keyboard focus) gets a tab's links ready: `value` is the category the tab would show.
  const ready = value => ({
    onPointerEnter: () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onPrefetch(value), HOVER_WAIT);
    },
    onPointerLeave: () => clearTimeout(timer.current),
    onFocus: () => onPrefetch(value),
  });
  const [more, setMore] = useState({ left: false, right: false }); // is there more to see on each side?
  const measure = useCallback(() => {
    const element = row.current;
    if (!element) return;
    setMore({
      left: element.scrollLeft > 4,
      right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4,
    });
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row.current);
    return () => observer.disconnect();
  }, [measure, categories.length]);
  // The chosen category slides into view. When the page opens on one, it's simply there (once the tabs are).
  const placed = useRef(false);
  useEffect(() => {
    const chosen = row.current?.querySelector('[aria-pressed="true"]');
    if (!chosen || !categories.length) return;
    row.current.scrollTo({ left: chosen.offsetLeft - 48, behavior: placed.current ? 'smooth' : 'instant' });
    placed.current = true;
  }, [category, categories.length]);
  const slide = direction => row.current.scrollBy({ left: direction * row.current.clientWidth * 0.7, behavior: 'smooth' });
  const total = categories.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className={`cat-tabs${more.left ? ' more-left' : ''}${more.right ? ' more-right' : ''}`}>
      <button type="button" className="cat-arrow left" aria-label="Earlier categories" tabIndex={-1} onClick={() => slide(-1)} hidden={!more.left}>
        <ChevronLeft size={18} />
      </button>
      <div className="cat-row" ref={row} onScroll={measure} role="group" aria-label="Category">
        <button type="button" className="cat-tab" aria-pressed={!category} onClick={() => onChange('')} {...ready('')}>
          All <span className="cat-count">{total}</span>
        </button>
        {categories.map(({ value, count }) => (
          <button
            key={value}
            type="button"
            className="cat-tab has-hue"
            style={hueOf(value)}
            aria-pressed={category === value}
            onClick={() => onChange(category === value ? '' : value)}
            {...ready(category === value ? '' : value)}
          >
            {categoryStyle(value).short} <span className="cat-count">{count}</span>
          </button>
        ))}
      </div>
      <button type="button" className="cat-arrow right" aria-label="More categories" tabIndex={-1} onClick={() => slide(1)} hidden={!more.right}>
        <ChevronRight size={18} />
      </button>
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

// `map` is { open, onToggle } when the map hides behind a button (on phones).
export default function Toolbar({ params, setParams, owner, facets, view, onView, selecting, onSelecting, map, onFiltersDone }) {
  const wrap = useRef(null);
  const stuck = useStuck(wrap);
  const prefetch = usePrefetch();
  return (
    <div className={`toolbar-wrap${stuck ? ' is-stuck' : ''}`} ref={wrap}>
      <div className="toolbar" role="toolbar" aria-label="Browse your links">
        <CategoryTabs
          categories={facets.categories}
          category={params.category}
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
            <button type="button" aria-pressed={view === 'cards'} aria-label="Cards" title="Cards" onClick={() => onView('cards')}>
              <LayoutGrid size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-pressed={view === 'list'} aria-label="List" title="List" onClick={() => onView('list')}>
              <List size={16} aria-hidden="true" />
            </button>
          </div>
          {/* Phones: one button that switches to the other view. */}
          <button
            type="button"
            className="tool-btn view-cycle"
            aria-label={view === 'list' ? 'Show as cards' : 'Show as a list'}
            title={view === 'list' ? 'Show as cards' : 'Show as a list'}
            onClick={() => onView(view === 'list' ? 'cards' : 'list')}
          >
            {view === 'list' ? <LayoutGrid size={16} aria-hidden="true" /> : <List size={16} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </div>
  );
}
