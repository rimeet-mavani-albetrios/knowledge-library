// The big search box. It waits until you stop typing for a moment (PAUSE), then searches: one pause, one search.
// A single letter doesn't search yet.
// A smaller copy (`compact`) sits in the top bar once you scroll past the big one.
// While you type, a panel under it shows the top results (open one straight away), matching tags, your recent searches,
// and "See all" for the whole list. ↑ ↓ move through it, Enter picks, Esc closes it. With no panel, ↓ goes to the results.
import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ArrowRight, Clock, Hash, LoaderCircle, Search, X } from 'lucide-react';
import { api, toQuery } from '../api.js';
import { useDebounced, useRecentSearches, forgetSearch } from '../hooks.js';
import { hostOf } from '../format.js';
import { SiteIcon } from './LinkCard.jsx';

const EXAMPLES = ['convert pdf to excel', 'run AI on my own computer', 'remove image background', 'learn prompt engineering'];
const TOP = 5; // how many results the panel shows
const PAUSE = 500; // ms without typing before the search (and the panel's tags) are fetched
const MIN_LETTERS = 2; // fewer than this is not a search yet

// What the panel shows for what's typed: `items` [{ kind: 'result' | 'tag' | 'recent' | 'all', … }] in the order
// they're shown, and a `status` line while there are no results to show yet.
// `results` is { page, loading }: the first page of the search, shared with the list below, so it costs nothing extra.
// `waiting` is true while those results belong to an older search, so they show faded.
function usePanel(text, open, results, waiting) {
  const recent = useRecentSearches();
  const typed = text.trim();
  const debounced = useDebounced(typed, PAUSE);
  const found = useQuery({
    queryKey: ['suggest', debounced],
    queryFn: ({ signal }) => api(`/suggest?${toQuery({ q: debounced })}`, { signal }),
    enabled: open && debounced.length >= MIN_LETTERS,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  if (!open) return { items: [] };
  if (!typed) return { items: recent.slice(0, 5).map(value => ({ kind: 'recent', value })) };
  const lower = typed.toLowerCase();
  // One letter: no search yet, only your recent searches with that letter.
  if (typed.length < MIN_LETTERS) {
    return { items: recent.filter(item => item.toLowerCase().includes(lower)).slice(0, 5).map(value => ({ kind: 'recent', value })) };
  }
  const page = results?.page;
  const top = (page?.items ?? []).slice(0, TOP);
  const items = [
    ...top.map(link => ({ kind: 'result', value: link.id, link })),
    ...(found.data?.tags ?? []).map(tag => ({ kind: 'tag', value: tag.value, count: tag.count })),
    ...recent
      .filter(item => item.toLowerCase() !== lower && item.toLowerCase().includes(lower))
      .slice(0, 2)
      .map(value => ({ kind: 'recent', value })),
  ];
  if (top.length) items.push({ kind: 'all', value: 'all', total: page.closestOnly ? 0 : page.total });
  let status = '';
  if (!top.length) status = waiting || !page ? 'Searching…' : `No links found for “${typed}”`;
  return { items, status, closest: Boolean(page?.closestOnly), faded: waiting };
}

const HEADINGS = { result: 'Top results', recent: 'Recent searches', tag: 'Tags' };

function allLabel(total) {
  if (!total) return 'See the nearest links';
  return total === 1 ? 'See it in the list' : `See all ${total} results`;
}

// Keeps the panel above the bottom of the screen (and above a phone's keyboard); what doesn't fit scrolls inside it.
function useFitHeight(ref) {
  useLayoutEffect(() => {
    const panel = ref.current;
    const screen = window.visualViewport;
    const fit = () => {
      const bottom = screen ? screen.offsetTop + screen.height : window.innerHeight;
      const room = bottom - panel.getBoundingClientRect().top - 12;
      panel.style.maxHeight = `${Math.max(160, Math.min(460, room))}px`;
    };
    fit();
    screen?.addEventListener('resize', fit);
    window.addEventListener('scroll', fit, { passive: true });
    return () => {
      screen?.removeEventListener('resize', fit);
      window.removeEventListener('scroll', fit);
    };
  }, [ref]);
}

function Panel({ id, panel, active, onPick, onHover }) {
  const ref = useRef(null);
  useFitHeight(ref);
  const { items, status, closest, faded } = panel;
  return (
    <div ref={ref} className={`suggest${faded ? ' is-faded' : ''}`}>
      {status && (
        <p className="suggest-status" role="status">
          {status}
        </p>
      )}
      <ul className="suggest-list" role="listbox" id={id} aria-label="Suggestions">
        {items.map((item, i) => (
          <li key={`${item.kind}:${item.value}`} role="presentation" className={item.kind === 'all' ? 'suggest-foot' : undefined}>
            {item.kind !== 'all' && (i === 0 || items[i - 1].kind !== item.kind) && (
              <p className="suggest-heading">{item.kind === 'result' && closest ? 'No close match. The nearest links' : HEADINGS[item.kind]}</p>
            )}
            <div
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`suggest-item suggest-${item.kind}${i === active ? ' is-active' : ''}`}
              // Keeps the focus in the search box, so the panel doesn't close before the click lands.
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(item)}
            >
              {item.kind === 'result' ? (
                <>
                  <SiteIcon link={item.link} />
                  <span className="suggest-text">{item.link.title}</span>
                  <span className="suggest-note">{item.link.source === 'github' ? 'GitHub' : hostOf(item.link.url)}</span>
                </>
              ) : item.kind === 'all' ? (
                <>
                  <span className="suggest-glyph"><ArrowRight size={16} aria-hidden="true" /></span>
                  <span className="suggest-text">{allLabel(item.total)}</span>
                  <kbd className="hide-small" aria-hidden="true">Enter</kbd>
                </>
              ) : item.kind === 'tag' ? (
                <>
                  <span className="suggest-glyph"><Hash size={16} aria-hidden="true" /></span>
                  <span className="suggest-text">{item.value}</span>
                  <span className="suggest-note">{item.count} {item.count === 1 ? 'link' : 'links'}</span>
                </>
              ) : (
                <>
                  <span className="suggest-glyph"><Clock size={16} aria-hidden="true" /></span>
                  <span className="suggest-text">{item.value}</span>
                  <button
                    type="button"
                    className="icon-btn icon-btn-sm suggest-forget"
                    aria-label={`Remove “${item.value}” from recent searches`}
                    title="Remove"
                    onClick={event => {
                      event.stopPropagation();
                      forgetSearch(item.value);
                    }}
                  >
                    <X size={15} />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// onSearch(text, show): `show` is true when you pressed Enter or picked "See all", an example or a recent search,
// so the page can bring the whole list into view. onOpenLink(id) and onTag(tag) are for the panel.
// `results` is { page, loading } for the top results (see usePanel).
// onDown() moves the focus to the results; it returns false when there are none.
const SearchBar = forwardRef(function SearchBar({ value, results, onSearch, onOpenLink, onTag, onDown, busy = false, compact = false }, ref) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text, PAUSE);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();

  // Follows the back button and example clicks, but keeps the space you just typed at the end.
  useEffect(() => setText(current => (current.trim() === value.trim() ? current : value)), [value]);
  useEffect(() => {
    const next = debounced.trim();
    if (next.length && next.length < MIN_LETTERS) return;
    if (next !== value.trim()) onSearch(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  useEffect(() => setActive(-1), [text]);

  // Spins while you type and while the results load.
  const searching = text.trim().length >= MIN_LETTERS && (busy || text.trim() !== value.trim());
  const Icon = searching ? LoaderCircle : Search;
  const panel = usePanel(text, open, results, text.trim() !== value.trim() || Boolean(results?.loading));
  const { items } = panel;
  const showList = items.length > 0 || Boolean(panel.status);

  function close() {
    setOpen(false);
    setActive(-1);
  }

  // Enter, "See all" or a recent search: the panel closes and the page shows the whole list.
  function showAll(q) {
    close();
    onSearch(q, true);
    // On touch screens the keyboard goes away too, so the list gets the whole screen.
    if (window.matchMedia('(pointer: coarse)').matches) ref?.current?.blur();
  }

  function pick(item) {
    close();
    if (item.kind === 'result') onOpenLink?.(item.value);
    else if (item.kind === 'all') showAll(text.trim());
    else if (item.kind === 'tag') {
      setText('');
      onTag?.(item.value);
    } else {
      setText(item.value);
      showAll(item.value);
    }
  }

  return (
    <div className={`search${compact ? ' search-compact' : ''}`}>
      <div className="search-field">
        <form
          className="search-box"
          role="search"
          onSubmit={event => {
            event.preventDefault();
            showAll(text.trim());
          }}
        >
          <Icon size={compact ? 18 : 22} className={`search-icon${searching ? ' spin' : ''}`} aria-hidden="true" />
          <input
            ref={ref}
            type="search"
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
            value={text}
            onChange={event => {
              setText(event.target.value);
              setOpen(true);
            }}
            // An empty box shows your recent searches. With text in it, the panel waits until you type,
            // so ↓ (say, coming back up from the results) goes to the results, not into the panel.
            onFocus={() => setOpen(!text.trim())}
            onBlur={close}
            onKeyDown={event => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                // No panel open: ↓ goes down to the results.
                if (!showList) {
                  if (event.key === 'ArrowDown' && onDown?.()) event.preventDefault();
                  return;
                }
                event.preventDefault();
                // Goes round: nothing chosen (-1), the first, …, the last, nothing again.
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setActive(current => ((current + 1 + step + items.length + 1) % (items.length + 1)) - 1);
              } else if (event.key === 'Enter' && showList && active >= 0 && items[active]) {
                event.preventDefault();
                pick(items[active]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (showList) close();
                else if (text) {
                  setText('');
                  onSearch('');
                }
              }
            }}
            placeholder={compact ? 'Search your library…' : 'What do you want to do? Like “convert pdf to excel”…'}
            aria-label="Search your library"
            autoComplete="off"
            spellCheck="false"
            enterKeyHint="search"
          />
          {text ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear search"
              onClick={() => {
                setText('');
                onSearch('');
                ref?.current?.focus();
              }}
            >
              <X size={18} />
            </button>
          ) : (
            !compact && <kbd className="hide-small" title="Press / to search">/</kbd>
          )}
        </form>
        {showList && <Panel id={listId} panel={panel} active={active} onPick={pick} onHover={setActive} />}
      </div>
      {!compact && (
        <p className="examples">
          <span>Try</span>
          {EXAMPLES.map(example => (
            <button key={example} type="button" onClick={() => onSearch(example, true)}>
              {example}
            </button>
          ))}
        </p>
      )}
    </div>
  );
});

export default SearchBar;
