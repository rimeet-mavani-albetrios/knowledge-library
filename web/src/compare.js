// The links you picked to compare: 2 to 4, remembered on this device, so a reload or another search keeps them.
// A copy of each link is kept too, so the compare window can show it at once (the server's fresh copy follows).
// The last few comparisons you opened are remembered here as well, so the picker can open one again.
import { useSyncExternalStore } from 'react';

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;
const KEY = 'kl-compare';
const RECENT_KEY = 'kl-compare-recent';
const RECENT_MAX = 5;

function readSaved(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

// The same link twice (an old bug, or a hand-edited list) would show twice in your picks, so it is kept once.
const onceEach = items => [...new Map(items.map(item => [item.id, item])).values()];

function read() {
  return onceEach(readSaved(KEY).filter(pick => typeof pick?.id === 'string')).slice(0, MAX_COMPARE);
}

const isComparison = item =>
  Array.isArray(item?.ids) &&
  item.ids.length >= MIN_COMPARE &&
  item.ids.length <= MAX_COMPARE &&
  item.ids.every(id => typeof id === 'string') &&
  Array.isArray(item.links) &&
  item.links.every(link => typeof link?.id === 'string');

function readRecent() {
  return readSaved(RECENT_KEY).filter(isComparison).slice(0, RECENT_MAX);
}

let picks = read();
let recent = readRecent();
const listeners = new Set();

function emit() {
  for (const listener of listeners) listener();
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing: it's only kept until the page closes.
  }
}

function save(next) {
  picks = next;
  store(KEY, next);
  emit();
}

const subscribe = listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Picks made in another tab of the library show up here too, so two tabs never overwrite each other's picks.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) picks = read();
    if (event.key === RECENT_KEY || event.key === null) recent = readRecent();
    if (event.key === KEY || event.key === RECENT_KEY || event.key === null) emit();
  });
}

// The link without what belongs to one search (where its words matched).
// eslint-disable-next-line no-unused-vars
export const brief = ({ snippet, match, ...link }) => link;

// Picks a link, or takes it out again. Gives 'added', 'removed', or 'full' when 4 are already picked
// (then nothing changes: a fifth link can't be picked).
export function togglePick(link) {
  if (picks.some(pick => pick.id === link.id)) {
    save(picks.filter(pick => pick.id !== link.id));
    return 'removed';
  }
  if (picks.length >= MAX_COMPARE) return 'full';
  save([...picks, brief(link)]);
  return 'added';
}

// Taking out links that aren't picked changes nothing, so nothing is drawn again.
export function removePicks(ids) {
  const next = picks.filter(pick => !ids.includes(pick.id));
  if (next.length !== picks.length) save(next);
}

export function clearPicks() {
  if (picks.length) save([]);
}

export const useComparePicks = () => useSyncExternalStore(subscribe, () => picks);
export const getPicks = () => picks; // for a click handler that needs the picks once, without following them

// Is this link one of your picks? Each card asks for its own yes or no, so a pick re-draws only the card that
// changed, not the whole list. With `on` false it's always no, and the card doesn't follow the picks at all.
export function useInTray(id, on = true) {
  return useSyncExternalStore(subscribe, () => on && picks.some(pick => pick.id === id));
}

// Are these the same links, in any order?
export const sameIds = (a, b) => a.length === b.length && a.every(id => b.includes(id));

// ---------- Recent comparisons ----------
// The last 5 comparisons, newest first, so one can be opened again with a click from the picker.
// Each keeps only what its line in the Recent list needs: [{ ids, links: [{ id, title, iconUrl, category, source, url }], at }].

// The compare window calls this with its links (2 to 4 link objects) once per comparison you open.
// The same links again (in any order) move to the top instead of showing twice.
export function rememberComparison(links) {
  const unique = onceEach((Array.isArray(links) ? links : []).filter(link => typeof link?.id === 'string')).slice(0, MAX_COMPARE);
  if (unique.length < MIN_COMPARE) return;
  const ids = unique.map(link => link.id);
  const entry = {
    ids,
    links: unique.map(({ id, title, iconUrl, category, source, url }) => ({ id, title, iconUrl, category, source, url })),
    at: Date.now(),
  };
  // Asked again for the comparison that is already on top, with nothing new (say, the window drew itself again):
  // nothing changes, so the picker isn't drawn again for nothing.
  const top = recent[0];
  if (top && top.ids.join() === ids.join() && JSON.stringify(top.links) === JSON.stringify(entry.links) && entry.at - top.at < 60_000) return;
  recent = [entry, ...recent.filter(item => !sameIds(item.ids, ids))].slice(0, RECENT_MAX);
  store(RECENT_KEY, recent);
  emit();
}

export const useRecentComparisons = () => useSyncExternalStore(subscribe, () => recent);

// ---------- Deleted links ----------
// A deleted link leaves your picks and your recent comparisons. A recent comparison keeps its other links, and
// goes when fewer than 2 are left (nothing to compare). The ids are also noted for this tab, so a comparison still
// holding one (Back into it) takes it out quietly: you know it's gone, you just deleted it.
const deleted = new Set();

export function forgetLinks(ids) {
  for (const id of ids) deleted.add(id);
  const gone = id => ids.includes(id);
  const without = item => ({ ...item, ids: item.ids.filter(id => !gone(id)), links: item.links.filter(link => !gone(link.id)) });
  const nextPicks = picks.filter(pick => !gone(pick.id));
  const nextRecent = recent
    .map(item => (item.ids.some(gone) ? without(item) : item))
    .filter(item => item.ids.length >= MIN_COMPARE)
    // Two comparisons that became the same links show once (the newer one).
    .filter((item, i, all) => all.findIndex(other => sameIds(other.ids, item.ids)) === i);
  const picksChanged = nextPicks.length !== picks.length;
  const recentChanged = nextRecent.length !== recent.length || nextRecent.some((item, i) => item !== recent[i]);
  if (picksChanged) {
    picks = nextPicks;
    store(KEY, picks);
  }
  if (recentChanged) {
    recent = nextRecent;
    store(RECENT_KEY, recent);
  }
  if (picksChanged || recentChanged) emit(); // once, so the picker is drawn again once
}

export const wasDeleted = id => deleted.has(id);
