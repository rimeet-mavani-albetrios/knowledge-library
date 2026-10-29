// The list of links for the current search and filters, 24 at a time.
// The grid and the map both use this; React Query shares one copy, so it's fetched only once.
import { useCallback, useEffect, useRef } from 'react';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { api, toQuery } from './api.js';

export function linkFilters(params) {
  const { q, exact, category, source, collection, tag, level, status, favorite, free, broken, sort } = params;
  return { q, exact: q ? exact : false, category, source, collection, tag, level, status, favorite, free, broken, sort: q ? '' : sort };
}

function linksQuery(params) {
  const filters = linkFilters(params);
  return {
    queryKey: ['links', filters],
    queryFn: ({ pageParam, signal }) => api(`/links?${toQuery(filters, { cursor: pageParam })}`, { signal }),
    initialPageParam: '',
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
  };
}

// How many links each filter option has (the toolbar's counts and the Filters panel).
export function facetsQuery(params) {
  const filters = { ...linkFilters(params), sort: undefined }; // the counts don't depend on the order
  return {
    queryKey: ['facets', filters],
    queryFn: ({ signal }) => api(`/facets?${toQuery(filters)}`, { signal }),
  };
}

export function useLinks(params) {
  return useInfiniteQuery({ ...linksQuery(params), placeholderData: keepPreviousData });
}

// ---------- Your place after a reload ----------
// A reload loads only the first page of links, so the browser couldn't scroll back to a place further down: you
// landed near the top. So as the page goes, this tab keeps how many pages were loaded and how far down you were
// (sessionStorage, for the same search and filters only). After the reload the same pages load again, then the page
// goes back to that spot. The browser's own scroll restoring is off: it would jump before the links are there.
// Scrolling or pressing a key yourself while they load calls the jump off, so it never yanks the page from you.
const PLACE_KEY = 'kl-place';
// Before anything is drawn: the browser restores the scroll early, as soon as the page is tall enough.
if (typeof window !== 'undefined' && 'scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';

// Only a reload (or Back / Forward into the page) goes back to the old place; opening the library afresh starts at
// the top, like any page.
function readPlace(key) {
  try {
    const place = JSON.parse(sessionStorage.getItem(PLACE_KEY));
    sessionStorage.removeItem(PLACE_KEY); // used once: a later reload saves its own
    const how = performance.getEntriesByType('navigation')[0]?.type;
    if (how !== 'reload' && how !== 'back_forward') return null;
    return place?.key === key && place.pages >= 1 && place.y >= 0 ? place : null;
  } catch {
    return null;
  }
}

export function useKeepPlace(links, params) {
  const key = JSON.stringify(linkFilters(params));
  const target = useRef(undefined); // { pages, y } to go back to, or null once done
  if (target.current === undefined) target.current = readPlace(key);
  const latest = useRef({});
  latest.current = { key, pages: links.data?.pages.length ?? 0 };

  // Kept as the page goes (a reload, a closed tab, or a phone putting the page away).
  useEffect(() => {
    const save = () => {
      const { key: now, pages } = latest.current;
      try {
        if (pages) sessionStorage.setItem(PLACE_KEY, JSON.stringify({ key: now, pages, y: Math.round(window.scrollY) }));
      } catch {
        // Private browsing without storage: a reload starts at the top.
      }
    };
    const onHide = () => document.visibilityState === 'hidden' && save();
    const giveUp = () => {
      target.current = null;
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHide);
    for (const type of ['wheel', 'touchstart', 'keydown']) window.addEventListener(type, giveUp, { passive: true, once: true });
    return () => {
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHide);
      for (const type of ['wheel', 'touchstart', 'keydown']) window.removeEventListener(type, giveUp);
    };
  }, []);

  // Loads the pages one after another, then scrolls back once they're all on the page.
  const { data, hasNextPage, isFetching, fetchNextPage } = links;
  useEffect(() => {
    const place = target.current;
    if (!place) return;
    if (key !== latest.current.key || !data) return;
    if (isFetching) return;
    if (data.pages.length < place.pages && hasNextPage) {
      fetchNextPage();
      return;
    }
    target.current = null;
    requestAnimationFrame(() => window.scrollTo({ top: place.y, behavior: 'instant' }));
  }, [key, data, hasNextPage, isFetching, fetchNextPage]);

  // Another search or filter before the old place was reached: there's nothing to go back to.
  const firstKey = useRef(key);
  if (key !== firstKey.current) target.current = null;
}

// Loads the results for other filters before you click: when the mouse rests on a category tab, say.
// The click then shows them at once. Results loaded in the last few minutes aren't loaded again.
export function usePrefetch() {
  const queryClient = useQueryClient();
  return useCallback(
    params => {
      queryClient.prefetchInfiniteQuery(linksQuery(params));
      queryClient.prefetchQuery(facetsQuery(params));
    },
    [queryClient],
  );
}
