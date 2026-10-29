// The results, as cards, as small tiles or as a list. Loads 24 at a time and fetches the next 24 when you scroll
// near the bottom. A search shows two groups: the best matches first, then links about something close. Only the
// first few related links show until you ask for more, so a search is a short page.
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LoaderCircle, Plus, RefreshCw, SearchX } from 'lucide-react';
import { linkFilters, useLinks } from '../useLinks.js';
import LinkCard, { LinkRow, LinkTile } from './LinkCard.jsx';
import { PeekLayer } from './Peek.jsx';
import BulkBar from './BulkBar.jsx';
import { detailQuery } from './LinkDrawer.jsx';

function SkeletonCard() {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      <div className="preview skeleton" />
      <div className="card-body">
        <span className="skeleton skeleton-badge" />
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-text" />
        <span className="skeleton skeleton-text short" />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="row skeleton-row" aria-hidden="true">
      <span className="row-icon skeleton" />
      <div className="row-main">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-text" />
      </div>
    </div>
  );
}

// The same boxes as a loaded tile (icon, room for the name and website, the tags line), so it's exactly as tall
// and nothing moves when the links arrive.
function SkeletonTile() {
  return (
    <div className="tile skeleton-tile" aria-hidden="true">
      <span className="tile-icon-skeleton skeleton" />
      <div className="tile-text">
        <span className="tile-title-skeleton skeleton" />
        <span className="tile-host-skeleton skeleton" />
      </div>
      <div className="tile-tags">
        <span className="tile-tag-skeleton skeleton" />
        <span className="tile-tag-skeleton short skeleton" />
      </div>
    </div>
  );
}

// `view` is 'cards', 'compact' or 'list'. Each has its own item, placeholder and layout class.
// The compact view's 24 placeholders are one page of links, and fill whole lines of 8, 6, 4, 3 or 2 tiles.
const VIEWS = {
  cards: { Item: LinkCard, Skeleton: SkeletonCard, layout: 'grid', skeletons: 8 },
  compact: { Item: LinkTile, Skeleton: SkeletonTile, layout: 'tiles', skeletons: 24 },
  list: { Item: LinkRow, Skeleton: SkeletonRow, layout: 'list', skeletons: 8 },
};
const viewOf = view => VIEWS[view] ?? VIEWS.cards;

function Group({ title, count, hint, view, children }) {
  return (
    <section className="result-group" aria-label={title}>
      <h2 className="group-title">
        {title} <span className="chip-count">{count}</span>
      </h2>
      {hint && <p className="group-hint">{hint}</p>}
      <div className={viewOf(view).layout}>{children}</div>
    </section>
  );
}

const RELATED_SHOWN = 6;
const LOAD_AHEAD_WAIT = 150; // the mouse rests this long on a link before its details load ahead

// Keys once a result has the focus (press ↓ in the search box, or Tab): ← → go one link, ↑ ↓ one line of cards
// or tiles, Enter opens the details, O opens the website. ↑ from the first result goes back to the search box.
function moveThroughResults(event) {
  const from = event.target;
  if (!from.classList?.contains('card-open') || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key === 'o' || event.key === 'O') {
    from.parentElement.querySelector('.btn-open')?.click();
    return;
  }
  const layout = from.closest('.grid, .tiles, .list');
  const columns = layout && !layout.classList.contains('list') ? getComputedStyle(layout).gridTemplateColumns.split(' ').length : 1;
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
  if (!step) return;
  event.preventDefault();
  const buttons = [...event.currentTarget.querySelectorAll('.card-open')];
  const to = buttons[buttons.indexOf(from) + step];
  if (to) to.focus();
  else if (step < 0) document.querySelector('.hero input[type="search"]')?.focus();
}

// `view` is 'cards', 'compact' or 'list'. `selecting` is on while you pick links to change many at once (the
// toolbar's Select button); `onStopSelecting` turns it off. (Links to compare are picked in their own window,
// ComparePicker.jsx, so the list never changes for that.)
// `chips` are the filters that are on, shown next to the count (nothing when none).
function LinkGrid({ params, setParams, owner, onOpen, onAdd, view, selecting, onStopSelecting, chips }) {
  const { q, category, source, collection, tag, level, status, favorite, free, broken } = params;
  const query = useLinks(params);
  const [allRelatedFor, setAllRelatedFor] = useState(null); // the search whose related links are all shown
  // The links picked while selecting. A new search or filter, or turning Select off, starts a new selection,
  // so nothing you can't see stays selected.
  const [selected, setSelected] = useState(() => new Set());
  const lastSummary = useRef(''); // the count line of the last results, kept while new ones load
  // Resting the mouse on a link loads its details ahead, so a click opens the window complete at once.
  // (Just moving across the links loads nothing; links loaded in the last few minutes aren't loaded again.)
  const queryClient = useQueryClient();
  const ahead = useRef({ id: null, timer: 0 });
  useEffect(() => () => clearTimeout(ahead.current.timer), []);
  const loadAhead = event => {
    if (selecting || event.pointerType === 'touch') return;
    const id = event.target.closest?.('[data-id]')?.dataset.id ?? null;
    if (id === ahead.current.id) return;
    clearTimeout(ahead.current.timer);
    ahead.current = { id, timer: id ? setTimeout(() => queryClient.prefetchQuery(detailQuery(id, q)), LOAD_AHEAD_WAIT) : 0 };
  };
  const filtersKey = JSON.stringify(linkFilters(params));
  useEffect(() => setSelected(new Set()), [filtersKey, selecting]);
  const toggle = useCallback(
    id =>
      setSelected(current => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );

  // When the invisible line under the cards comes close to the screen, load the next page.
  // (It's only there once all the related links are shown.)
  const [sentinel, setSentinel] = useState(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (query.isError && !query.data) {
    return (
      <div className="empty">
        <h2>Couldn’t load the library</h2>
        <p>{query.error.message}</p>
        <button type="button" className="btn btn-ghost" onClick={() => query.refetch()}>
          <RefreshCw size={16} aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  // While a new search or filter loads, the last list stays on screen (faded) instead of jumping around.
  // Its numbers belong to the last search, so none of them are shown.
  const stale = query.isPlaceholderData;
  const pages = query.data?.pages ?? [];
  const links = pages.flatMap(page => page.items);
  const first = stale ? undefined : pages[0];
  const filtered = category || source || collection || tag || level || status || favorite || free || broken;
  const searched = first?.corrected ?? q;
  const grouped = q && first && !first.closestOnly;

  // Only a search gets a line above the links ("12 links found for …"). Browsing has none: the count was just noise,
  // and the grey placeholder boxes already show that links are loading. While a search's new results load, its
  // last line stays (with a small spinner) and changes once, when they're here.
  const loading = stale || query.isLoading;
  let summary = '';
  if (!q) lastSummary.current = '';
  else if (loading) summary = lastSummary.current || `Searching for “${q}”…`;
  else if (first?.closestOnly) summary = `Nothing matches “${searched}” closely. These are the nearest links.`;
  else if (first) summary = `${first.total} ${first.total === 1 ? 'link' : 'links'} found for “${searched}”`;
  if (q && !loading) lastSummary.current = summary;

  const { Item, Skeleton, layout, skeletons: skeletonCount } = viewOf(view);
  const item = link => (
    <Item
      key={link.id}
      link={link}
      owner={owner}
      onOpen={onOpen}
      selectable={selecting}
      selected={selected.has(link.id)}
      onToggle={toggle}
    />
  );
  const loadingMore = query.isLoading || isFetchingNextPage || (stale && !links.length);
  const skeletons =
    loadingMore && Array.from({ length: isFetchingNextPage ? Math.ceil(skeletonCount / 2) : skeletonCount }, (_, i) => <Skeleton key={`s${i}`} />);
  const best = links.filter(link => link.match === 'best');
  const related = links.filter(link => link.match !== 'best');
  // Without best matches the related links are all there is, so a few more show.
  const allRelated = !grouped || allRelatedFor === q;
  const shownRelated = allRelated ? related : related.slice(0, first.bestTotal ? RELATED_SHOWN : RELATED_SHOWN * 2);
  const hiddenRelated = grouped ? first.total - first.bestTotal - shownRelated.length : 0;

  return (
    <section
      className="results"
      id="results"
      aria-label="Links"
      aria-busy={query.isFetching}
      onKeyDown={moveThroughResults}
      onPointerOver={loadAhead}
      onPointerLeave={loadAhead}
    >
      {summary || chips ? (
        <div className="results-head">
          <p className="results-summary" aria-live="polite" aria-busy={loading}>
            {summary}
            {loading && summary ? <LoaderCircle size={15} className="spin summary-spin" aria-label="Loading" /> : null}
          </p>
          {chips}
        </div>
      ) : null}
      {first?.corrected && (
        <p className="spelling">
          Showing results for <strong>{first.corrected}</strong>.{' '}
          <button type="button" className="link-btn" onClick={() => setParams({ exact: true })}>
            Search for “{q}” instead
          </button>
        </p>
      )}

      <div className={`results-body${stale ? ' is-stale' : ''}`}>
        {!loadingMore && !stale && links.length === 0 ? (
          q || filtered ? (
            <div className="empty">
              <SearchX size={36} aria-hidden="true" />
              <h2>No matches</h2>
              <p>{q ? 'Try fewer words, or describe what you want to do, like “edit videos” or “learn Python”.' : 'No links match these filters.'}</p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setParams({ q: '', category: '', source: '', collection: '', tag: '', level: '', status: '', favorite: false, free: false, broken: false })
                }
              >
                Clear search and filters
              </button>
            </div>
          ) : (
            <div className="empty">
              <h2>{owner ? 'Start your library' : 'This library is empty'}</h2>
              <p>
                {owner
                  ? 'Paste links you want to keep. Each one gets a summary, a category and tags automatically.'
                  : 'Links will show up here once the owner adds them.'}
              </p>
              {owner && (
                <button type="button" className="btn btn-primary" onClick={onAdd}>
                  <Plus size={18} aria-hidden="true" /> Add your first links
                </button>
              )}
            </div>
          )
        ) : grouped ? (
          <>
            {best.length > 0 && (
              <Group title="Best matches" count={first.bestTotal} view={view}>
                {best.map(item)}
              </Group>
            )}
            {related.length > 0 && (
              <Group
                title={first.bestTotal ? 'Also related' : 'Related links'}
                count={first.total - first.bestTotal}
                hint={first.bestTotal ? 'About something close to your search.' : 'Nothing matches exactly. These are about something close.'}
                view={view}
              >
                {shownRelated.map(item)}
              </Group>
            )}
            {!allRelated && hiddenRelated > 0 && (
              <button type="button" className="btn btn-ghost show-more" onClick={() => setAllRelatedFor(q)}>
                <ChevronDown size={17} aria-hidden="true" /> Show {hiddenRelated} more related {hiddenRelated === 1 ? 'link' : 'links'}
              </button>
            )}
            {skeletons && <div className={layout}>{skeletons}</div>}
          </>
        ) : (
          <div className={`${layout}${first?.closestOnly ? ' is-closest' : ''}`}>
            {links.map(item)}
            {skeletons}
          </div>
        )}
      </div>

      {allRelated && <div ref={setSentinel} className="sentinel" />}
      {selecting && (
        <BulkBar
          ids={[...selected]}
          allIds={(grouped ? [...best, ...shownRelated] : links).map(link => link.id)}
          onSelect={setSelected}
          onDone={onStopSelecting}
        />
      )}
      {allRelated && !hasNextPage && !stale && links.length > 12 && <p className="end-note">That’s everything.</p>}
      {/* The one hover panel for every card, row and tile. It rests while you're selecting. */}
      <PeekLayer active={!selecting} />
    </section>
  );
}

// Opening or closing a window doesn't change the results, so the list isn't drawn again then.
export default memo(LinkGrid);
