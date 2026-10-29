// "Pick links to compare": a window with a search box on the left and your picks (2 to 4) on the right (a bar at the
// bottom on phones). Type a name ("figma") or what the tool does ("pdf to excel"). Before you type, it offers links
// like your picks, the links on your screen, and the comparisons you opened before.
// Keys: ↓ from the search box goes into the list, ↑ ↓ move, Space or Enter ticks, typing goes back to the box, Esc closes.
// Two modes:
// - 'pick' (the toolbar's Compare button): ticks go straight to your picks (compare.js), kept like a cart, so the
//   toolbar's badge and the cards' "In compare" marks follow. "Compare N" opens the compare window, and that
//   empties the cart (App's openCompare); the comparison lives on in "Recent comparisons".
// - 'edit' (the compare window's "Add link"): starts from the links compared, and ticks change only this window's
//   copy until "Update compare". It opens on top of the compare window; closing it leaves that one open.
// Props: mode ('pick' | 'edit', or null when closed), compareIds (the links compared, for 'edit'), screenLinks (the
// first links of the list on the page), q (the search on the page), onClose(), onCompare(ids) (open these links in
// the compare window: Compare, or a recent comparison), onUpdate(ids) ('edit': the compare window's new links).
// Inside a <dialog>, so every "show this or nothing" is written `cond ? (…) : null`, never `cond && …`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, Search, X } from 'lucide-react';
import Modal from './Modal.jsx';
import { api, toQuery } from '../api.js';
import { PHONE, useDebounced, useMediaQuery } from '../hooks.js';
import { detailQuery } from './LinkDrawer.jsx';
import {
  MAX_COMPARE, MIN_COMPARE, brief, clearPicks, removePicks, sameIds, togglePick, useComparePicks, useRecentComparisons,
} from '../compare.js';
import { PickRow, PickRowSkeleton, PicksPanel, RecentRow, Section } from './ComparePickerParts.jsx';
import './compare-picker.css';

const PAUSE = 200; // ms without typing before it searches
const MIN_LETTERS = 2; // fewer is not a search yet
const BY_MEANING = 12; // how many links the search by meaning brings
const SIMILAR_SHOWN = 8;
const READY_WAIT = 1500; // the longest the Compare button waits for links it doesn't know well yet

// ---------- Finding links ----------

// Two searches, each shown as soon as it's back: by name (finds "FigJam" from "fig", in a blink) and by meaning,
// like the big search box (finds "pdf to excel" tools, in a second or two). Name matches come first and the
// meaning matches are added under them when they arrive; a link found both ways shows once, with the fuller copy.
// While you type on, or the new search is on its way, the last list stays (faded) instead of blinking away.
// Gives null while the box has fewer than 2 letters.
function useFind(typed) {
  const debounced = useDebounced(typed, PAUSE);
  const on = debounced.length >= MIN_LETTERS;
  const byName = useQuery({
    queryKey: ['suggest', debounced], // the big search box's own name search, so they share what's loaded
    queryFn: ({ signal }) => api(`/suggest?${toQuery({ q: debounced })}`, { signal }),
    enabled: on,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const byMeaning = useQuery({
    queryKey: ['compare-find', debounced],
    queryFn: ({ signal }) => api(`/links?${toQuery({ q: debounced, limit: BY_MEANING })}`, { signal }),
    enabled: on,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const last = useRef([]); // the list shown last, kept while the next one loads
  if (typed.length < MIN_LETTERS) {
    last.current = [];
    return null;
  }
  // "Done" means back for what's typed now (not the last search's answer, kept on screen meanwhile).
  const nameDone = on && !byName.isPlaceholderData && (byName.isSuccess || byName.isError);
  const meaningDone = on && !byMeaning.isPlaceholderData && (byMeaning.isSuccess || byMeaning.isError);
  const names = nameDone ? (byName.data?.links ?? []) : [];
  const meaning = meaningDone ? (byMeaning.data?.items ?? []) : [];
  let items = last.current;
  let old = true;
  // Name matches alone are shown only when there are some: no names yet means the last list stays a little longer.
  if (meaningDone || names.length) {
    const fuller = new Map(meaning.map(link => [link.id, link]));
    const named = names.map(link => fuller.get(link.id) ?? link);
    const seen = new Set(named.map(link => link.id));
    items = [...named, ...meaning.filter(link => !seen.has(link.id))];
    last.current = items;
    old = false;
  }
  const typing = typed !== debounced;
  return {
    items,
    text: debounced,
    faded: typing || old,
    more: typing || !meaningDone, // more links may still come
    failed: meaningDone && byMeaning.isError && !names.length,
    done: !typing && meaningDone,
  };
}

// ---------- Before you type ----------

// Details loaded for another search have the same similar links, so they show at once while these load.
function loadedDetails(queryClient, id) {
  return queryClient.getQueriesData({ queryKey: ['link', id] }).find(([, data]) => Array.isArray(data?.similar))?.[1];
}

// Stable (outside the component), so the lists are only worked out again when a pick's details change.
// `waiting`: some pick's details haven't come yet, so more similar links may still arrive.
// (A pick whose details failed to load isn't waited for.)
const similarLists = results => ({ lists: results.map(result => result.data?.similar ?? []), waiting: results.some(result => result.isPending) });

// "Similar to your picks": the similar links of each pick you had when the window opened (from its details, often
// loaded already), taking turns so every pick has its say, without those picks and without a link twice.
// The list holds still while the window is open: a link you tick stays in its place (ticked), and a new pick
// brings no new rows. Rows that moved or went away under the mouse made the next click tick a different link.
// Gives { links, waiting }; while waiting, the window holds the rest of the section's places with grey rows.
function useSimilar(startIds) {
  const queryClient = useQueryClient();
  const { lists, waiting } = useQueries({
    queries: startIds.map(id => ({ ...detailQuery(id, ''), placeholderData: () => loadedDetails(queryClient, id) })),
    combine: similarLists,
  });
  const kept = useRef([]); // the rows shown so far, in their places; details still loading only add rows at the end
  const links = useMemo(() => {
    const seen = new Set([...startIds, ...kept.current.map(link => link.id)]);
    const shown = [...kept.current];
    const longest = Math.max(0, ...lists.map(list => list.length));
    for (let i = 0; i < longest && shown.length < SIMILAR_SHOWN; i++) {
      for (const list of lists) {
        const link = list[i];
        if (link && !seen.has(link.id) && shown.length < SIMILAR_SHOWN) {
          seen.add(link.id);
          shown.push(link);
        }
      }
    }
    kept.current = shown;
    return shown;
  }, [lists, startIds]);
  return { links, waiting };
}

// ---------- Your picks ----------

// A copy of a link already loaded somewhere (the comparison, a details window, the list), for its name and icon.
function loadedCopy(queryClient, id, compareKey) {
  const compared = queryClient.getQueryData(['compare', compareKey])?.items?.find(link => link.id === id);
  if (compared) return compared;
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['link', id] })) if (data?.link) return data.link;
  for (const [, data] of queryClient.getQueriesData({ queryKey: ['links'] })) {
    for (const page of data?.pages ?? []) {
      const found = page.items.find(link => link.id === id);
      if (found) return found;
    }
  }
  return null;
}

// The links picked in this window, and how to change them. 'pick': your picks in compare.js. 'edit': a copy of the
// links compared (`startIds`), changed only here. A link compared but not loaded anywhere (the compare window
// opened from a shared address and still loading, say) gets its name from the server; until then it's just { id }.
function usePickList(edit, startIds) {
  const queryClient = useQueryClient();
  const picks = useComparePicks();
  const startKey = startIds.join(',');
  const [draft, setDraft] = useState(() => startIds.map(id => loadedCopy(queryClient, id, startKey) ?? { id }));
  const unnamed = edit && draft.some(link => link.title === undefined);
  const compared = useQuery({
    queryKey: ['compare', startKey], // the compare window's own question, so it's asked only once
    queryFn: () => api(`/compare?ids=${encodeURIComponent(startKey)}`),
    enabled: unnamed,
  });
  const toggleDraft = useCallback(
    link =>
      setDraft(current => {
        if (current.some(other => other.id === link.id)) return current.filter(other => other.id !== link.id);
        return current.length >= MAX_COMPARE ? current : [...current, link];
      }),
    [],
  );
  const removeDraft = useCallback(id => setDraft(current => current.filter(link => link.id !== id)), []);
  const clearDraft = useCallback(() => setDraft([]), []);
  const removePick = useCallback(id => removePicks([id]), []);

  if (!edit) return { picked: picks, toggle: togglePick, remove: removePick, clear: clearPicks, loadingNames: false };
  const named = new Map((compared.data?.items ?? []).map(link => [link.id, link]));
  return {
    picked: draft.map(link => (link.title === undefined ? (named.get(link.id) ?? link) : link)),
    toggle: toggleDraft,
    remove: removeDraft,
    clear: clearDraft,
    loadingNames: compared.isFetching,
  };
}

// Gets the compare window's links ready before it opens, so it shows them complete at once (not as grey rows).
// Links known in full (found by meaning, on your screen, similar…) are handed over as they are, marked as old so
// the window still asks the server for fresh copies. A link found only by its name has no details yet: then the
// comparison is loaded first, for a moment at most. Gives a promise to wait for, or null when it's ready now.
function readyComparison(queryClient, links) {
  const key = links.map(link => link.id).join(',');
  const queryKey = ['compare', key];
  if (queryClient.getQueryData(queryKey)) return null;
  if (links.every(link => Array.isArray(link.tags))) {
    queryClient.setQueryData(queryKey, { items: links.map(brief) }, { updatedAt: 0 });
    return null;
  }
  return Promise.race([
    queryClient.prefetchQuery({ queryKey, queryFn: () => api(`/compare?ids=${encodeURIComponent(key)}`) }),
    new Promise(resolve => setTimeout(resolve, READY_WAIT)),
  ]);
}

// ---------- The window's content ----------

// Mounted only while the window is open (and fading out), so each opening starts with an empty box.
function PickerBody({ open, edit, compareIds, screenLinks, q, phone, onCompare, onUpdate }) {
  const queryClient = useQueryClient();
  const input = useRef(null);
  const list = useRef(null);
  const stillOpen = useRef(open);
  stillOpen.current = open;
  const [startIds] = useState(compareIds); // 'edit': the links compared when the window opened
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const { picked, toggle, remove, clear, loadingNames } = usePickList(edit, startIds);
  const pickedIds = picked.map(link => link.id);
  const pickedKey = pickedIds.join(',');
  const [startPicked] = useState(pickedIds); // the picks when the window opened, for "Similar to your picks"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ticked = useMemo(() => new Set(pickedIds), [pickedKey]);
  const full = picked.length >= MAX_COMPARE;
  const typed = text.trim();
  const find = useFind(typed);
  const { links: similar, waiting: similarWaiting } = useSimilar(startPicked);
  const recent = useRecentComparisons();
  // Without the comparison of the picks you opened with (Compare does that one); fixed too, so rows hold still.
  const others = recent.filter(item => !sameIds(item.ids, startPicked));
  const focusSearch = useCallback(() => input.current?.focus({ preventScroll: true }), []);

  const go = async () => {
    if (picked.length < MIN_COMPARE || busy) return;
    const ids = picked.map(link => link.id);
    if (edit && ids.join(',') === startIds.join(',')) {
      onUpdate(ids); // nothing changed: the window just closes
      return;
    }
    const waiting = readyComparison(queryClient, picked);
    if (waiting) {
      setBusy(true);
      await waiting;
      // Closed in the meantime (Esc): you changed your mind, so nothing happens.
      if (!stillOpen.current) return;
    }
    if (edit) onUpdate(ids);
    else onCompare(ids);
  };

  // ↓ from the box goes to the first row; ↑ ↓ (Home, End) move through the rows, ↑ from the first goes back to the box.
  // The rows are real buttons, so Space and Enter tick them. Typing on a row goes on in the search box.
  const onKeyDown = event => {
    if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const rows = [...(list.current?.querySelectorAll('[data-row]') ?? [])];
    const fromBox = event.target === input.current;
    const at = rows.indexOf(event.target);
    if (!fromBox && at < 0) return;
    let to;
    if (event.key === 'ArrowDown') to = fromBox ? 0 : Math.min(at + 1, rows.length - 1);
    else if (event.key === 'ArrowUp' && !fromBox) to = at - 1;
    else if (event.key === 'Home' && !fromBox) to = 0;
    else if (event.key === 'End' && !fromBox) to = rows.length - 1;
    else {
      // The letter (or Backspace) lands in the box, which takes the focus before the key does its work.
      if (!fromBox && ((event.key.length === 1 && event.key !== ' ') || event.key === 'Backspace')) focusSearch();
      return;
    }
    event.preventDefault();
    if (to < 0) focusSearch();
    else rows[to]?.focus();
  };

  const row = link => (
    <PickRow key={link.id} link={link} ticked={ticked.has(link.id)} locked={full && !ticked.has(link.id)} onToggle={toggle} />
  );

  let content;
  if (find) {
    let status = '';
    if (!find.items.length) {
      if (find.failed) status = "Couldn't search. Check your internet connection.";
      else if (find.done) status = `No links found for “${find.text}”.`;
      else status = 'Searching…';
    }
    content = (
      <>
        <p className="picker-status" role="status">
          {status}
        </p>
        {find.items.length ? (
          <div className={`picker-results${find.faded ? ' is-faded' : ''}`}>
            {find.items.map(row)}
            {find.more ? (
              <p className="picker-more">
                <LoaderCircle size={14} className="spin" aria-hidden="true" /> Finding more by what they do…
              </p>
            ) : null}
          </div>
        ) : null}
      </>
    );
  } else {
    const nothing = !similar.length && !similarWaiting && !screenLinks.length && !others.length;
    // Grey rows keep the section's places until every pick's similar links are in, so "On your screen" below
    // doesn't move down under the mouse when they arrive.
    const placeholders = similarWaiting ? Math.max(0, SIMILAR_SHOWN - similar.length) : 0;
    const recentSection = others.length ? (
      <Section title="Recent comparisons">
        {others.map(item => (
          <RecentRow key={item.ids.join(',')} item={item} onOpen={onCompare} />
        ))}
      </Section>
    ) : null;
    content = (
      <>
        {similar.length || placeholders ? (
          <Section title="Similar to your picks">
            {similar.map(row)}
            {Array.from({ length: placeholders }, (_, i) => (
              <PickRowSkeleton key={i} />
            ))}
          </Section>
        ) : null}
        {/* Nothing picked (say, right after a comparison: opening it empties your picks): the comparisons you
            opened come first, so going back to the last one is one click. */}
        {startPicked.length ? null : recentSection}
        {screenLinks.length ? <Section title={q ? `Results for “${q}”` : 'On your screen'}>{screenLinks.map(row)}</Section> : null}
        {startPicked.length ? recentSection : null}
        {nothing ? (
          <p className="picker-hint">
            Type what the tool does, or its name.
            <span>Like “pdf to excel” or “figma”.</span>
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="picker-body">
      <div className="picker-main" onKeyDown={onKeyDown}>
        <div className="picker-find">
          <Search size={17} aria-hidden="true" />
          <input
            ref={input}
            type="text"
            value={text}
            onChange={event => setText(event.target.value)}
            placeholder="Search by name or what it does…"
            aria-label="Find links in your library"
            // On a phone the keyboard would cover half the list, so the box waits for a tap there.
            data-autofocus={phone ? undefined : ''}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
          />
          {find?.more ? <LoaderCircle size={16} className="spin picker-find-spin" aria-label="Searching" /> : null}
          {text ? (
            <button
              type="button"
              className="icon-btn icon-btn-sm picker-find-clear"
              aria-label="Clear the search"
              onClick={() => {
                setText('');
                focusSearch();
              }}
            >
              <X size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div ref={list} className="picker-list">
          {content}
        </div>
      </div>
      <PicksPanel
        picked={picked}
        edit={edit}
        phone={phone}
        busy={busy}
        loadingNames={loadingNames}
        onRemove={remove}
        onClear={clear}
        onGo={go}
        onLeave={focusSearch}
      />
    </div>
  );
}

export default function ComparePicker({ mode, compareIds, screenLinks, q, onClose, onCompare, onUpdate }) {
  const phone = useMediaQuery(PHONE);
  const open = Boolean(mode);
  // While the window fades out, it keeps showing the mode it had.
  const lastMode = useRef(mode);
  if (mode) lastMode.current = mode;
  const edit = (mode ?? lastMode.current) === 'edit';
  // Handing over to the compare window: this one goes without its fade, and the compare window comes without its
  // own, so the dark page behind stays as it is (no flash, no doubled darkness). Each opening fades in again.
  const [handover, setHandover] = useState(false);
  if (open && handover) setHandover(false);
  const compare = ids => {
    if (!edit) setHandover(true); // 'edit' sits on top of the compare window, which stays: a normal fade then
    onCompare(ids);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={edit ? 'Add or take out links' : 'Pick links to compare'}
      description="Pick 2 to 4 links."
      size="lg"
      className="picker-dialog"
      instant={handover}
    >
      <PickerBody
        key={edit ? 'edit' : 'pick'}
        open={open}
        edit={edit}
        compareIds={compareIds}
        screenLinks={screenLinks}
        q={q}
        phone={phone}
        onCompare={compare}
        onUpdate={onUpdate}
      />
    </Modal>
  );
}
