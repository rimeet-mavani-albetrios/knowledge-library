// The detail window's website facts: the "At a glance" chips under the title and the tabs
// Overview / Popularity / Company / Trust / History.
// Every card is its own file in ./cards. A card file exports `tab`, `order`, a default component
// ({ link, facts, history, owner }) that returns null when it has nothing to show, and optionally
// `glance(facts, link)` → { icon, text, tab, tone } | null for a chip. New cards need no change here.
import { useEffect, useId, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle } from 'lucide-react';
import { api } from '../../api.js';
import { timeAgo } from '../../format.js';
import './facts.css';

// `kinds`: the facts a tab shows, so an empty tab can say "Collecting facts…" while they're on their way.
export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'popularity', label: 'Popularity', kinds: ['app', 'stars', 'popularity', 'youtube'] },
  { id: 'company', label: 'Company', kinds: ['company', 'wikidata'] },
  { id: 'trust', label: 'Trust', kinds: ['trust', 'tls', 'age', 'trackers', 'safety'] },
  { id: 'history', label: 'History', kinds: ['archive', 'prices', 'features', 'stars'] },
];
const CHIP_ORDER = ['popularity', 'trust', 'company', 'history', 'overview'];

const CARDS = Object.entries(import.meta.glob('./cards/*.jsx', { eager: true }))
  .map(([file, card]) => ({ file, tab: card.tab, order: card.order ?? 50, Card: card.default, glance: card.glance }))
  .filter(card => card.Card && TABS.some(tab => tab.id === card.tab))
  .sort((a, b) => a.order - b.order);

// Facts change at most once a day, so a link opened again within 10 minutes shows them at once.
export const factsQuery = id => ({ queryKey: ['facts', id], queryFn: () => api(`/links/${id}/facts`), staleTime: 10 * 60_000 });

const asked = new Set(); // links whose missing facts we already asked the server to collect

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
      .then(fresh => queryClient.setQueryData(['facts', id], fresh))
      .catch(() => asked.delete(id));
  }, [id, owner, data, queryClient]);
  return facts;
}

// The chips: each one opens the tab it comes from. While the facts load or are being collected, the row keeps its
// place (`loading`), so the buttons under it don't jump when the first chips arrive.
export function Glance({ link, data, loading, onPick }) {
  const chips = CARDS.flatMap(card => {
    try {
      const chip = data && card.glance?.(data.facts, link);
      return chip?.text ? [{ ...chip, tab: chip.tab ?? card.tab, key: card.file, rank: CHIP_ORDER.indexOf(chip.tab ?? card.tab) }] : [];
    } catch {
      return []; // one broken card must not break the window
    }
  }).sort((a, b) => a.rank - b.rank);
  if (!chips.length) return loading ? <div className="facts-glance" aria-hidden="true" /> : null;
  return (
    <ul className="facts-glance" aria-label="At a glance">
      {chips.map(({ key, icon: Icon, text, tab, tone }) => (
        <li key={key}>
          <button type="button" className={`glance-chip${tone ? ` is-${tone}` : ''}`} onClick={() => onPick(tab)} title={`See ${TABS.find(item => item.id === tab)?.label}`}>
            {Icon ? <Icon size={14} aria-hidden="true" /> : null}
            {text}
          </button>
        </li>
      ))}
    </ul>
  );
}

function EmptyNote({ data, kinds }) {
  if (!data) {
    return (
      <p className="facts-empty">
        <LoaderCircle size={15} className="spin" aria-hidden="true" /> Loading facts…
      </p>
    );
  }
  const waiting = data.pending?.some(kind => kinds.includes(kind));
  return waiting ? (
    <p className="facts-empty">
      <LoaderCircle size={15} className={data.collecting ? 'spin' : ''} aria-hidden="true" /> Collecting facts… They show up here on their own.
    </p>
  ) : (
    <p className="facts-empty">Nothing found for this website.</p>
  );
}

// `overview`: what the window showed before the tabs (summary, what you can do with it…), shown under the Overview cards.
export default function FactsTabs({ link, owner, data, tab, onTab, overview, tabsRef }) {
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
            <EmptyNote data={data} kinds={current.kinds} />
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
