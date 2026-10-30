// The detail window's website facts: the row of small fact tiles under the name and the tabs
// Overview / Popularity / Company / Trust / History.
// Every card is its own file in ./cards. A card file exports `tab`, `order`, a default component
// ({ link, facts, history, owner }) that returns null when it has nothing to show, and optionally
// `glance(facts, link)` → { icon, label, value, note, rank, tab, tone, spare } | null for a tile (a lower `rank` sits
// further left; `spare` tiles are the first to go when there are too many). New cards need no change here.
import { useEffect, useId, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Earth, History, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from '../../api.js';
import { timeAgo } from '../../format.js';
import './facts.css';

// `kinds`: the facts a tab shows, so an empty tab can say "Collecting facts…" while they're on their way.
export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'popularity', label: 'Popularity', kinds: ['app', 'stars', 'popularity', 'youtube'], Icon: Earth, none: 'No popularity numbers for this website yet.' },
  { id: 'company', label: 'Company', kinds: ['company', 'wikidata', 'place'], Icon: Building2, none: 'We couldn’t find who runs this website.' },
  { id: 'trust', label: 'Trust', kinds: ['trust', 'tls', 'age', 'trackers', 'safety'], Icon: ShieldCheck, none: 'No trust checks for this website yet.' },
  { id: 'history', label: 'History', kinds: ['archive', 'prices', 'features', 'stars'], Icon: History, none: 'No history for this website yet.' },
];
const MAX_TILES = 5; // this many fit one row, and the row is only ever one row, so nothing under it moves

const CARDS = Object.entries(import.meta.glob('./cards/*.jsx', { eager: true }))
  .map(([file, card]) => ({ file, tab: card.tab, order: card.order ?? 50, Card: card.default, glance: card.glance }))
  .filter(card => card.Card && TABS.some(tab => tab.id === card.tab))
  .sort((a, b) => a.order - b.order);

// Facts change at most once a day, so a link opened again within 10 minutes shows them at once.
export const factsQuery = id => ({ queryKey: ['facts', id], queryFn: () => api(`/links/${id}/facts`), staleTime: 10 * 60_000 });

const asked = new Set(); // links whose missing facts we already asked the server to collect
const answered = new Set(); // ...and the server has answered: what is still missing after that stays missing for now

// The facts of the link on screen. When you're the owner and some were never checked, the server is asked once to
// collect them now; while it works, the facts are loaded again every few seconds so they fill in.
export function useLinkFacts(id, owner) {
  const queryClient = useQueryClient();
  const facts = useQuery({
    ...factsQuery(id),
    enabled: Boolean(id),
    refetchInterval: query => (query.state.data?.collecting ? 2500 : false),
  });
  const data = facts.data;
  useEffect(() => {
    if (!owner || !id || !data?.pending?.length || data.collecting || asked.has(id)) return;
    asked.add(id);
    api(`/links/${id}/facts?collect=1`)
      .then(fresh => {
        answered.add(id);
        queryClient.setQueryData(['facts', id], fresh);
      })
      .catch(() => {
        answered.add(id);
        asked.delete(id);
      });
  }, [id, owner, data, queryClient]);
  return facts;
}

// Are more facts still on their way? Then the tiles keep their place.
export const factsBusy = (data, id, owner) => !data || data.collecting || Boolean(owner && data.pending?.length > 0 && !answered.has(id));

// The fact tiles: each one opens the tab it comes from. While the facts load or are being collected, the row keeps
// its place with empty tiles (`loading`), so nothing under it jumps when the real ones arrive.
export function Glance({ link, data, loading, onPick }) {
  const held = useRef(null); // the link whose row kept its place while its facts were on their way
  const facts = data?.facts ?? {};
  let tiles = CARDS.flatMap(card => {
    try {
      const tile = card.glance?.(facts, link);
      return tile?.value ? [{ ...tile, tab: tile.tab ?? card.tab, key: card.file }] : [];
    } catch {
      return []; // one broken card must not break the window
    }
  }).sort((a, b) => (a.rank ?? 50) - (b.rank ?? 50));
  // Too many for the row: the spare ones go first, from the right, one at a time.
  for (let at = tiles.length - 1; at >= 0 && tiles.length > MAX_TILES; at--) {
    if (tiles[at].spare) tiles.splice(at, 1);
  }
  tiles = tiles.slice(0, MAX_TILES);
  if (!tiles.length) {
    if (loading) held.current = link.id;
    else if (held.current !== link.id) return null;
    // The facts came and there is nothing to show: the row stays as empty space, so nothing under it moves up.
    return (
      <div className="facts-glance" aria-hidden="true">
        {loading ? (
          <>
            <span className="glance-ghost" />
            <span className="glance-ghost" />
            <span className="glance-ghost" />
            <span className="glance-ghost" />
          </>
        ) : null}
      </div>
    );
  }
  return (
    <ul className="facts-glance" aria-label="At a glance">
      {tiles.map(({ key, icon: Icon, label, value, note, tab, tone }) => (
        <li key={key}>
          <button type="button" className={`glance-tile${tone ? ` is-${tone}` : ''}`} onClick={() => onPick(tab)} title={`See ${TABS.find(item => item.id === tab)?.label}`}>
            <span className="glance-label">
              {Icon ? <Icon size={13} aria-hidden="true" /> : null}
              <span>{label}</span>
            </span>
            <span className="glance-value">
              <strong>{value}</strong>
              {note ? <small>{note}</small> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// What an empty tab says: still collecting, or a calm "nothing found" with the tab's own icon.
function EmptyNote({ data, tab }) {
  const { kinds, Icon, none } = tab;
  const waiting = !data || data.pending?.some(kind => kinds.includes(kind));
  return (
    <div className="facts-empty">
      <span className="facts-empty-icon" aria-hidden="true">
        {waiting ? <LoaderCircle size={20} className={!data || data.collecting ? 'spin' : ''} /> : <Icon size={20} />}
      </span>
      <p>{!data ? 'Loading facts…' : waiting ? 'Collecting facts… They show up here on their own.' : none}</p>
    </div>
  );
}

// `lead` and `overview`: what the window itself knows about the link. On the Overview tab `lead` (what it's for, your
// note) comes first, then the Overview cards (the fit check), then `overview` (what you can do with it and the rest).
export default function FactsTabs({ link, owner, data, tab, onTab, lead, overview, tabsRef }) {
  const ids = useId();
  const listRef = useRef(null);
  const current = TABS.find(item => item.id === tab) ?? TABS[0];
  const props = {
    link,
    owner,
    facts: data?.facts ?? {},
    history: data?.history ?? {},
    checked: data?.checked ?? {},
    pending: data?.pending ?? [],
    collecting: Boolean(data?.collecting),
  };
  const cards = CARDS.filter(card => card.tab === current.id);
  const lastCheck = Object.values(props.checked).sort().at(-1);

  // ← → between the tabs (and not to the next link, which the window does with the same keys).
  const onKey = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    event.stopPropagation();
    const at = TABS.indexOf(current);
    const to =
      event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (at + (event.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    onTab(TABS[to].id);
    listRef.current?.querySelectorAll('[role="tab"]')[to]?.focus();
  };

  return (
    <div className="facts-box" ref={tabsRef}>
      <div className="facts-tabs" role="tablist" aria-label="About this website" ref={listRef} onKeyDown={onKey}>
        {TABS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${ids}-${item.id}`}
            className="facts-tab"
            aria-selected={item.id === current.id}
            aria-controls={`${ids}-panel`}
            tabIndex={item.id === current.id ? 0 : -1}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="facts-panel" role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-${current.id}`}>
        {current.id === 'overview' ? (
          <>
            {lead}
            {cards.map(({ file, Card }) => (
              <Card key={`${file}-${link.id}`} {...props} />
            ))}
            {overview}
          </>
        ) : (
          <>
            {/* A card with nothing to show renders nothing, so an empty box means an empty tab (see facts.css). */}
            <div className="facts-cards">
              {cards.map(({ file, Card }) => (
                <Card key={`${file}-${link.id}`} {...props} />
              ))}
            </div>
            <EmptyNote data={data} tab={current} />
            {lastCheck ? (
              <p className="facts-checked" title={new Date(lastCheck).toLocaleString()}>
                Facts checked {timeAgo(lastCheck)}. They are checked again on their own.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
