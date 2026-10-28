// The list of links for the current search and filters, 24 at a time.
// The grid and the map both use this; React Query shares one copy, so it's fetched only once.
import { useCallback } from 'react';
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
