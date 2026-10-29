// Shared React hooks: address-bar state, theme, live progress, saving changes, keyboard shortcuts, sizes.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, toQuery } from './api.js';
import { isWorking } from './format.js';

// ---------- Filters live in the address bar, so a search can be bookmarked or shared ----------

const DEFAULTS = {
  q: '', exact: false, category: '', source: '', collection: '', tag: '', level: '', status: '', favorite: false, free: false,
  broken: false, sort: 'newest', link: '', compare: '',
};
const YES_NO = new Set(['exact', 'favorite', 'free', 'broken']);
// The choices that stay with you when Back leaves a search (see useUrlState).
const KEPT_ON_BACK = ['category', 'source', 'collection', 'tag', 'level', 'status', 'favorite', 'free', 'broken', 'sort'];

function readUrl() {
  const search = new URLSearchParams(window.location.search);
  const state = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (!search.has(key)) continue;
    state[key] = YES_NO.has(key) ? search.get(key) === '1' : search.get(key);
  }
  return state;
}

// The address for a state: only what differs from the defaults goes in it.
function urlFor(state) {
  const changed = Object.fromEntries(Object.entries(state).filter(([key, value]) => value !== DEFAULTS[key]));
  const query = toQuery(changed);
  return query ? `?${query}` : window.location.pathname;
}

export function useUrlState() {
  const [state, setState] = useState(readUrl);
  const current = useRef(state);

  useEffect(() => {
    const onBack = () => {
      const leaving = current.current;
      const next = readUrl();
      // Back out of a search should only undo the search. A category (or filter, or order) picked while the
      // search was open changed the search's own step, so the older step doesn't have it: carry it over,
      // and write it into the address so a reload keeps it too.
      if (leaving.q && !next.q) {
        for (const key of KEPT_ON_BACK) next[key] = leaving[key];
        window.history.replaceState(window.history.state, '', urlFor(next));
      }
      setState((current.current = next));
    };
    window.addEventListener('popstate', onBack);
    return () => window.removeEventListener('popstate', onBack);
  }, []);

  // `step` (like 'link' or 'search') adds a new step for the Back button; without it the current step is updated.
  const update = useCallback((changes, step) => {
    const next = { ...current.current, ...changes };
    current.current = next;
    const url = urlFor(next);
    if (step) window.history.pushState({ step }, '', url);
    else window.history.replaceState(window.history.state, '', url);
    setState(next);
  }, []);

  return [state, update];
}

// Back should go through your searches, not through every pause while you type.
// A new search gets its own step; adding or removing letters only updates the current one.
export function searchStep(previous, next) {
  if (!next) return previous ? 'clear' : undefined;
  if (!previous) return window.history.state?.step === 'clear' ? undefined : 'search';
  return next.startsWith(previous) || previous.startsWith(next) ? undefined : 'search';
}

// How wide an element is on screen, kept up to date when the window changes size.
export function useWidth(ref, fallback) {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth || fallback);
    const observer = new ResizeObserver(([entry]) => entry.contentRect.width && setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}

// True while the screen matches a CSS media query, like '(max-width: 640px)'.
export function useMediaQuery(media) {
  return useSyncExternalStore(
    listener => {
      const list = window.matchMedia(media);
      list.addEventListener('change', listener);
      return () => list.removeEventListener('change', listener);
    },
    () => window.matchMedia(media).matches,
  );
}

export const PHONE = '(max-width: 640px)';

// ---------- Cards, compact cards or a list ----------
// Until you pick one, searches and phones get the list: many more results fit on one screen.
// Your pick is remembered on this device.

export const VIEWS = ['cards', 'compact', 'list'];

export function useView(searching) {
  const phone = useMediaQuery(PHONE);
  const [choice, setChoice] = useState(() => {
    try {
      const saved = localStorage.getItem('kl-view');
      return VIEWS.includes(saved) ? saved : ''; // a value from an older version of the app is ignored
    } catch {
      return '';
    }
  });
  const choose = useCallback(value => {
    if (!VIEWS.includes(value)) return;
    setChoice(value);
    try {
      localStorage.setItem('kl-view', value);
    } catch {
      // private browsing: the choice just isn't remembered
    }
  }, []);
  return [choice || (searching || phone ? 'list' : 'cards'), choose];
}

// ---------- Your recent searches, kept on this device ----------
// A search counts once you press Enter, pick an example, or open one of its results.

const RECENT_KEY = 'kl-recent';
const recentListeners = new Set();
let recentSearches = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY));
    return Array.isArray(saved) ? saved.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
})();

function saveRecent(list) {
  recentSearches = list;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private browsing: they just aren't remembered
  }
  for (const listener of recentListeners) listener();
}

export function rememberSearch(text) {
  const q = text.trim();
  if (q.length < 2 || recentSearches[0] === q) return;
  saveRecent([q, ...recentSearches.filter(item => item.toLowerCase() !== q.toLowerCase())].slice(0, 8));
}

export const forgetSearch = text => saveRecent(recentSearches.filter(item => item !== text));

export function useRecentSearches() {
  return useSyncExternalStore(
    listener => {
      recentListeners.add(listener);
      return () => recentListeners.delete(listener);
    },
    () => recentSearches,
  );
}

// ---------- Theme: light, dark, or match the device ----------

export function useTheme() {
  const [choice, setChoice] = useState(() => {
    try {
      return localStorage.getItem('kl-theme') || 'system';
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1220' : '#f6f7fb');
    };
    apply();
    try {
      localStorage.setItem('kl-theme', choice);
    } catch {
      // private browsing: the choice just isn't remembered
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);

  return [choice, setChoice];
}

// ---------- Live progress while the robot works ----------
// Links you just added are "tracked". Every 2 seconds the page asks the server how they're doing,
// and updates their cards. When nothing is being worked on, it stops asking, so the server can rest.

const tracked = new Map(); // id → latest link
const listeners = new Set();
let version = 0;

function emit() {
  version++;
  for (const listener of listeners) listener();
}

export function trackLinks(links) {
  for (const link of links) tracked.set(link.id, link);
  emit();
}

export function useTracked(ids) {
  useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
  return ids.map(id => tracked.get(id)).filter(Boolean);
}

// Puts fresh copies of links into every list, detail view and compare window already on screen.
// Fresh copies are merged in, so a list's short copy never wipes out the details already shown.
export function patchLinks(queryClient, fresh) {
  const byId = new Map(fresh.map(link => [link.id, link]));
  const merge = link => (byId.has(link.id) ? { ...link, ...byId.get(link.id) } : link);
  queryClient.setQueriesData({ queryKey: ['links'] }, data =>
    data?.pages ? { ...data, pages: data.pages.map(page => ({ ...page, items: page.items.map(merge) })) } : data,
  );
  queryClient.setQueriesData({ queryKey: ['compare'] }, data => (data?.items ? { ...data, items: data.items.map(merge) } : data));
  for (const link of fresh) {
    queryClient.setQueriesData({ queryKey: ['link', link.id] }, data => (data ? { ...data, link: { ...data.link, ...link } } : data));
  }
}

// Opening a link (its details or its website) counts as using it, so the ones you use most come up first in search,
// and it shows in "Recently opened" at the top of the home page.
// At most once a minute per link, so going back and forth doesn't count twice.
const counted = new Map(); // id → time
export function useCountOpen() {
  return useCallback(id => {
    if (Date.now() - (counted.get(id) ?? 0) < 60_000) return;
    counted.set(id, Date.now());
    api(`/links/${id}/open`, { method: 'POST' }).catch(() => {});
  }, []);
}

// Saves a change to one link (the star, your status…). It shows on screen at once and goes back if saving fails.
export function useUpdateLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ link, changes }) => api(`/links/${link.id}`, { method: 'PATCH', body: changes }),
    onMutate: ({ link, changes }) => patchLinks(queryClient, [{ ...link, ...changes }]),
    onError: (error, { link }) => patchLinks(queryClient, [link]),
    onSuccess: ({ link }) => {
      patchLinks(queryClient, [link]);
      queryClient.invalidateQueries({ queryKey: ['facets'] });
    },
  });
}

export function useProgressPolling() {
  const queryClient = useQueryClient();
  useEffect(() => {
    let stopped = false;
    let timer;
    async function poll() {
      const ids = new Set([...tracked.values()].filter(isWorking).map(link => link.id));
      for (const [, data] of queryClient.getQueriesData({ queryKey: ['links'] })) {
        for (const page of data?.pages ?? []) for (const link of page.items) if (isWorking(link)) ids.add(link.id);
      }
      if (ids.size) {
        try {
          const { items } = await api(`/progress?ids=${[...ids].slice(0, 200).join(',')}`);
          const finished = items.some(link => !isWorking(link));
          for (const link of items) if (tracked.has(link.id)) tracked.set(link.id, link);
          emit();
          patchLinks(queryClient, items);
          if (finished) {
            queryClient.invalidateQueries({ queryKey: ['facets'] });
            queryClient.invalidateQueries({ queryKey: ['me'] });
            queryClient.invalidateQueries({ queryKey: ['map'] });
          }
        } catch {
          // try again on the next round
        }
      }
      if (!stopped) timer = setTimeout(poll, ids.size ? 2000 : 4000);
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [queryClient]);
}

// ---------- Keyboard: "/" to search, "n" to add links ----------

export function useShortcuts(shortcuts) {
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  useEffect(() => {
    const onKey = event => {
      // A menu or panel already used the key (Esc closing the Filters panel, say).
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.target.closest?.('input, textarea, select, [contenteditable], dialog')) return;
      // A window is open (details, Add links…): the page behind it shouldn't react to keys.
      if (document.querySelector('dialog[open]')) return;
      const action = latest.current[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
