// Deleting with a way back, the same for one link (the details window) and for many (Select mode).
// The links leave the screen at once and a message offers Undo. About 8 seconds later the server really deletes them.
// Until then nothing has happened on the server: they are only hidden here, in this tab, so closing the tab or
// reloading the page deletes nothing. Your compare picks and recent comparisons let go of them only once they're
// really gone.
import { useCallback, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from './api.js';
import { forgetLinks } from './compare.js';
import { useToast } from './components/Toasts.jsx';

const WAIT_MS = 8000;
const LOOK_AGAIN_MS = 1000; // the mouse or keyboard is on the message: wait this much longer, and look again
// Everything that can still show a deleted link. Only what's on screen is loaded again right away.
const SHOWN_IN = ['links', 'link', 'facets', 'me', 'map', 'compare', 'compare-facts', 'duplicates', 'stats', 'suggest', 'explore-search', 'saved-check'];

const hidden = new Set(); // links waiting to be deleted, and the ones deleted since this tab opened (old copies may be around)
const wholeViews = new Set(); // lists whose every link is waiting to be deleted, also the ones not loaded yet
const listeners = new Set();
let version = 0;

function changed() {
  version++;
  for (const listener of listeners) listener();
}

// Draws the component again whenever links get hidden or come back. Gives a number that changes then.
export function useHiddenLinks() {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
  );
}

export const isHidden = id => hidden.has(id);

// One name for a list, whatever its order: the same links are in it.
export const viewKey = filters => JSON.stringify({ ...filters, sort: '' });
export const isWholeViewHidden = key => wholeViews.has(key);

const lessBy = (number, by) => (number === undefined ? number : Math.max(number - by, 0));

// A list's loaded pages without the hidden links, and its numbers lowered to match. (The list's own copy stays as it
// was, so Undo brings the links back at once, in the same places.)
export function withoutHidden(data, key) {
  if (!hidden.size) return data;
  let lost = 0;
  let lostBest = 0;
  const pages = data.pages.map(page => {
    const items = page.items.filter(link => !hidden.has(link.id));
    if (items.length === page.items.length) return page;
    lost += page.items.length - items.length;
    lostBest += page.items.filter(link => link.match === 'best' && hidden.has(link.id)).length;
    return { ...page, items };
  });
  const whole = isWholeViewHidden(key);
  if (!lost && !whole) return data;
  const [first, ...rest] = pages;
  const left = pages.flatMap(page => page.items);
  const numbers = whole
    ? { total: left.length, bestTotal: left.filter(link => link.match === 'best').length }
    : { total: lessBy(first.total, lost), bestTotal: lessBy(first.bestTotal, lostBest) };
  return { ...data, pages: [{ ...first, ...numbers }, ...rest] };
}

// `deleteLater(ids, { title, description, wholeView })`. `title` and `description` are the message's words.
// `wholeView` is the list's filters when these ids are all of it, so it doesn't load page after page of hidden links.
export function useDeleteLater() {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useCallback(
    (ids, { title, description, wholeView }) => {
      const chosen = ids.filter(id => !hidden.has(id));
      if (!chosen.length) return;
      const view = wholeView ? viewKey(wholeView) : null;
      for (const id of chosen) hidden.add(id);
      if (view) wholeViews.add(view);
      changed();

      const bringBack = () => {
        for (const id of chosen) hidden.delete(id);
        wholeViews.delete(view);
        changed();
      };

      const reallyDelete = async () => {
        try {
          await api('/links/bulk', { method: 'POST', body: { ids: chosen, action: 'delete' } });
        } catch (error) {
          bringBack();
          toast({ title: chosen.length === 1 ? 'Couldn’t delete that link' : `Couldn’t delete those ${chosen.length} links`, description: error.message, tone: 'error' });
          return;
        }
        forgetLinks(chosen);
        const gone = new Set(chosen);
        queryClient.removeQueries({ predicate: ({ queryKey: [kind, id] }) => (kind === 'link' || kind === 'facts') && gone.has(id) });
        changed(); // a window still showing one of them (Forward brought it back) now says it's gone
        await Promise.all(SHOWN_IN.map(key => queryClient.invalidateQueries({ queryKey: [key] })));
        if (view && wholeViews.delete(view)) changed(); // the list has been loaded again, so it knows the truth by itself now
      };

      let timer = 0;
      const message = toast({
        title,
        description,
        tone: 'info',
        duration: 0, // it stays until the links are really deleted (see below)
        action: {
          label: 'Undo',
          onClick: () => {
            clearTimeout(timer);
            bringBack();
          },
        },
      });
      const wait = ms => {
        timer = setTimeout(() => {
          // You may be about to press Undo: messages hold still while the mouse or keyboard is on them.
          if (document.querySelector('.toasts:hover, .toasts:focus-within')) {
            wait(LOOK_AGAIN_MS);
            return;
          }
          toast.dismiss(message);
          reallyDelete();
        }, ms);
      };
      wait(WAIT_MS);
    },
    [queryClient, toast],
  );
}
