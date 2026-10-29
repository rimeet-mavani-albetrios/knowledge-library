// The "Filters" button and its panel: where links come from, "show only" (free, favorites, broken links),
// your status, level, collection and tags, each in its own named section with counts.
// Chosen filters show as chips with an × in a thin row under the toolbar (so they stay in view while you
// scroll), and the button grows an × of its own that clears them all. The owner can rename a tag there too.
import { useCallback, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Star, Pencil, SlidersHorizontal, Unlink, Search, Folder, BadgeDollarSign } from 'lucide-react';
import { api } from '../api.js';
import { facetsQuery } from '../useLinks.js';
import { LEVEL_LABELS, MY_STATUS_LABELS } from '../format.js';
import { GitHubIcon } from './Icons.jsx';
import { useToast } from './Toasts.jsx';
import { Popover } from './Popover.jsx';

const SOURCES = [
  ['', 'All'],
  ['github', 'GitHub'],
  ['web', 'Websites'],
  ['youtube', 'YouTube'],
];

// The chosen tag, with a way for the owner to rename it everywhere (or merge it into another tag).
function ActiveTag({ tag, owner, setParams }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(tag);
  const rename = useMutation({
    mutationFn: () => api('/tags/rename', { method: 'POST', body: { from: tag, to: name } }),
    onSuccess: ({ changed }) => {
      setRenaming(false);
      setParams({ tag: name.trim() });
      for (const key of ['links', 'link', 'facets']) queryClient.invalidateQueries({ queryKey: [key] });
      toast(`Tag renamed on ${changed} ${changed === 1 ? 'link' : 'links'}`);
    },
    onError: error => toast(error.message, 'error'),
  });

  if (renaming) {
    return (
      <form
        className="rename-tag"
        onSubmit={event => {
          event.preventDefault();
          if (name.trim() && name.trim() !== tag) rename.mutate();
        }}
      >
        <label className="sr-only" htmlFor="rename-tag">New name for {tag}</label>
        <input id="rename-tag" className="input" value={name} onChange={event => setName(event.target.value)} maxLength={40} autoFocus />
        <button type="submit" className="btn btn-primary" disabled={rename.isPending}>
          {rename.isPending ? 'Saving…' : 'Rename'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setRenaming(false)}>
          Cancel
        </button>
        <span className="hint">Same name as another tag? They become one.</span>
      </form>
    );
  }
  return (
    <>
      <button type="button" className="chip chip-active-tag" onClick={() => setParams({ tag: '' })} aria-label={`Remove tag filter ${tag}`}>
        #{tag} <X size={14} aria-hidden="true" />
      </button>
      {owner && (
        <button
          type="button"
          className="icon-btn"
          title="Rename this tag on every link"
          aria-label={`Rename tag ${tag}`}
          onClick={() => {
            setName(tag);
            setRenaming(true);
          }}
        >
          <Pencil size={16} />
        </button>
      )}
    </>
  );
}

// A filter you chose, shown above the results with an × to take it off.
function ActiveChip({ label, onRemove }) {
  return (
    <button type="button" className="chip chip-active" onClick={onRemove} aria-label={`Remove filter: ${label}`}>
      {label} <X size={14} aria-hidden="true" />
    </button>
  );
}

const EMPTY = { categories: [], sources: [], collections: [], levels: [], statuses: [], tags: [], free: 0, favorites: 0, broken: 0, total: 0 };
const CLEAR_ALL = { source: '', free: false, favorite: false, level: '', status: '', collection: '', tag: '', broken: false };

// How many links each filter option has, for the current search and filters. Shared by the toolbar and the panel.
export function useFacets(params) {
  const facets = useQuery({ ...facetsQuery(params), placeholderData: keepPreviousData });
  return facets.data ?? EMPTY;
}

// The filters that are on, except the category (the toolbar shows that one): [{ key, label, clear }].
function activeFilters(params) {
  const { source, collection, level, status, favorite, free, broken } = params;
  return [
    source && { key: 'source', label: SOURCES.find(([value]) => value === source)?.[1] ?? source, clear: { source: '' } },
    free && { key: 'free', label: 'Free', clear: { free: false } },
    favorite && { key: 'favorite', label: 'Favorites', clear: { favorite: false } },
    broken && { key: 'broken', label: 'Broken links', clear: { broken: false } },
    status && { key: 'status', label: MY_STATUS_LABELS[status] ?? status, clear: { status: '' } },
    level && { key: 'level', label: LEVEL_LABELS[level] ?? level, clear: { level: '' } },
    collection && { key: 'collection', label: collection, clear: { collection: '' } },
  ].filter(Boolean);
}

export const activeCount = params => activeFilters(params).length + (params.tag ? 1 : 0);

// The chips under the toolbar: one per filter that's on, each with an ×. Nothing when no filter is on.
export function ActiveFilters({ params, setParams, owner }) {
  const active = activeFilters(params);
  if (!active.length && !params.tag) return null;
  return (
    <div className="active-filters" aria-label="Filters that are on">
      <span className="active-filters-label">Showing</span>
      {active.map(({ key, label, clear }) => (
        <ActiveChip key={key} label={label} onRemove={() => setParams(clear)} />
      ))}
      {params.tag && <ActiveTag key={params.tag} tag={params.tag} owner={owner} setParams={setParams} />}
      {activeCount(params) > 1 && (
        <button type="button" className="link-btn" onClick={() => setParams(CLEAR_ALL)}>
          Clear all
        </button>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="fp-section">
      <h3 className="fp-title">{title}</h3>
      <div className="fp-options">{children}</div>
    </section>
  );
}

// One choice of a group (status, level): click it again to turn it off.
function Choice({ on, onClick, children }) {
  return (
    <button type="button" className="fp-chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function FiltersPanel({ params, setParams, data, onDone }) {
  const { source, collection, tag, level, status, favorite, free, broken } = params;
  const [find, setFind] = useState('');
  const count = (list, value) => list.find(item => item.value === value)?.count ?? 0;
  const sources = SOURCES.filter(([value]) => !value || count(data.sources, value) || source === value);
  const needle = find.trim().toLowerCase();
  const tags = data.tags.filter(item => !needle || item.value.toLowerCase().includes(needle)).slice(0, needle ? 40 : 18);
  const showOnly = [
    (data.free > 0 || free) && { key: 'free', on: free, label: 'Free', Icon: BadgeDollarSign, n: data.free },
    (data.favorites > 0 || favorite) && { key: 'favorite', on: favorite, label: 'Favorites', Icon: Star, n: data.favorites },
    (data.broken > 0 || broken) && { key: 'broken', on: broken, label: 'Broken links', Icon: Unlink, n: data.broken },
  ].filter(Boolean);

  return (
    <div className="filters-panel">
      <div className="fp-body">
        {sources.length > 2 && (
          <Section title="Where from">
            <div className="segmented segmented-text" role="group" aria-label="Where links come from">
              {sources.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={source === value} onClick={() => setParams({ source: value })}>
                  {value === 'github' && <GitHubIcon size={14} />}
                  {label}
                </button>
              ))}
            </div>
          </Section>
        )}

        {showOnly.length > 0 && (
          <Section title="Show only">
            {showOnly.map(({ key, on, label, Icon, n }) => (
              <Choice key={key} on={on} onClick={() => setParams({ [key]: !on })}>
                <Icon size={15} aria-hidden="true" /> {label} <span className="chip-count">{n}</span>
              </Choice>
            ))}
          </Section>
        )}

        {(data.statuses.length > 0 || status) && (
          <Section title="Your status">
            {Object.entries(MY_STATUS_LABELS).map(([value, label]) => (
              <Choice key={value} on={status === value} onClick={() => setParams({ status: status === value ? '' : value })}>
                {label} <span className="chip-count">{count(data.statuses, value)}</span>
              </Choice>
            ))}
          </Section>
        )}

        {(data.levels.length > 0 || level) && (
          <Section title="Level">
            {Object.entries(LEVEL_LABELS).map(([value, label]) => (
              <Choice key={value} on={level === value} onClick={() => setParams({ level: level === value ? '' : value })}>
                {label} <span className="chip-count">{count(data.levels, value)}</span>
              </Choice>
            ))}
          </Section>
        )}

        {(data.collections.length > 0 || collection) && (
          <Section title="Collection">
            {data.collections.map(({ value, count: n }) => (
              <Choice key={value} on={collection === value} onClick={() => setParams({ collection: collection === value ? '' : value })}>
                <Folder size={15} aria-hidden="true" /> {value} <span className="chip-count">{n}</span>
              </Choice>
            ))}
            {collection && !count(data.collections, collection) && (
              <Choice on onClick={() => setParams({ collection: '' })}>
                <Folder size={15} aria-hidden="true" /> {collection}
              </Choice>
            )}
          </Section>
        )}

        {data.tags.length > 0 && (
          <Section title="Tags">
            <label className="fp-find">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Find a tag</span>
              <input type="search" value={find} onChange={event => setFind(event.target.value)} placeholder="Find a tag" autoComplete="off" />
            </label>
            <div className="fp-tags">
              {tags.map(({ value, count: n }) => (
                <button
                  key={value}
                  type="button"
                  className="fp-tag"
                  aria-pressed={tag === value}
                  onClick={() => setParams({ tag: tag === value ? '' : value })}
                  title={`${n} ${n === 1 ? 'link' : 'links'}`}
                >
                  #{value}
                </button>
              ))}
              {!tags.length && <span className="hint">No tag has “{find.trim()}” in it.</span>}
            </div>
          </Section>
        )}

      </div>
      <footer className="fp-foot">
        {activeCount(params) > 0 ? (
          <button type="button" className="link-btn" onClick={() => setParams(CLEAR_ALL)}>
            Clear all
          </button>
        ) : (
          <span />
        )}
        <button type="button" className="btn btn-primary" onClick={onDone}>
          Show {data.total.toLocaleString()} {data.total === 1 ? 'link' : 'links'}
        </button>
      </footer>
    </div>
  );
}

// The "Filters" button in the toolbar, with a badge that says how many filters are on.
// With filters on it becomes two buttons in one: "Filters (2)" opens the panel, the × next to it clears them all
// (the category stays: that's the toolbar's own choice) without opening anything.
export function FiltersButton({ params, setParams, data, onDone }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  const on = activeCount(params);
  return (
    <div className={`dropdown filters-drop${on ? ' is-split' : ''}`}>
      <button
        ref={button}
        type="button"
        className={`tool-btn${open ? ' is-open' : ''}${on ? ' is-on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={on ? `Filters, ${on} on` : 'Filters'}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal size={16} aria-hidden="true" />
        <span className="tool-label">Filters</span>
        {on > 0 && <span className="filters-badge">{on}</span>}
      </button>
      {on > 0 && (
        <button type="button" className="tool-btn is-on filters-clear" aria-label="Clear all filters" title="Clear all filters" onClick={() => setParams(CLEAR_ALL)}>
          <X size={16} aria-hidden="true" />
        </button>
      )}
      <Popover open={open} onClose={close} anchor={button} label="Filters" role="dialog" className="filters-pop" focusFirst=".fp-section button, .fp-section input">
        <FiltersPanel
          params={params}
          setParams={setParams}
          data={data}
          onDone={() => {
            close();
            onDone?.();
          }}
        />
      </Popover>
    </div>
  );
}
