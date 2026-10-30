import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Lock } from 'lucide-react';
import { api, LOGIN_NEEDED } from './api.js';
import { useUrlState, useProgressPolling, useShortcuts, searchStep, useMediaQuery, PHONE, rememberSearch, useView } from './hooks.js';
import { linkFilters, useKeepPlace, useLinks } from './useLinks.js';
import Header from './components/Header.jsx';
import SearchBar from './components/SearchBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import { useFacets } from './components/Filters.jsx';
import LinkGrid from './components/LinkGrid.jsx';
import KnowledgeMap from './components/KnowledgeMap.jsx';
import LinkDrawer from './components/LinkDrawer.jsx';
import { ComparePicker, CompareWindow } from './components/Compare.jsx';
import { MAX_COMPARE, MIN_COMPARE, clearPicks, getPicks, removePicks, sameIds } from './compare.js';
import AddDialog from './components/AddDialog.jsx';
import SaveButtonDialog from './components/SaveButtonDialog.jsx';
import LoginDialog, { LoginForm } from './components/LoginDialog.jsx';
import { LogoMark } from './components/Icons.jsx';
import { useToast } from './components/Toasts.jsx';

// The Stats page and its world map load only when you open it, so the library itself stays fast.
const loadStats = () => import('./components/StatsPage.jsx');
const StatsPage = lazy(loadStats);
// The owner's "Find duplicates" window loads the first time it opens, too: most visits never need it.
const Duplicates = lazy(() => import('./components/Duplicates.jsx'));
// The Explore map page, also loaded only when you open it.
const Explore = lazy(() => import('./components/Explore.jsx'));
// The filters a click on the Stats page starts from: only the country (or category, or broken links) it was about.
const NO_FILTERS = {
  q: '', exact: false, category: '', source: '', collection: '', tag: '', level: '', status: '', favorite: false, free: false, broken: false,
  country: '', trust: false,
};

function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 1200);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button type="button" className="to-top" aria-label="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <ArrowUp size={20} />
    </button>
  );
}

// Brings the toolbar and the top of the results into view when you have scrolled past them.
// With 'low' it also does that when they start low on the screen; with 'top' it always puts them right under the top bar.
function scrollToResults(how) {
  const results = document.getElementById('browse');
  if (!results) return;
  const { top } = results.getBoundingClientRect();
  const header = document.querySelector('.app-header')?.offsetHeight ?? 0;
  if (top < header || (how === 'low' && top > window.innerHeight * 0.55) || (how === 'top' && top > header + 1)) {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    results.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  }
}

const SCREEN_LINKS = 20; // how many of the links on the page the compare picker offers before you type

function PrivateGate({ title }) {
  return (
    <main className="gate">
      <LogoMark size={44} />
      <h1>{title}</h1>
      <p>
        <Lock size={16} aria-hidden="true" /> This library is private.
      </p>
      <LoginForm />
    </main>
  );
}

export default function App() {
  const [params, setParams] = useUrlState();
  const paramsRef = useRef(params); // the latest address-bar state, for callbacks that never change
  paramsRef.current = params;
  // The search and filters without the open windows: opening or closing a link's details or the compare window
  // doesn't touch the map, the toolbar or the list, so they aren't drawn again then.
  const { q, exact, category, source, collection, tag, level, status, favorite, free, broken, sort, country, trust } = params;
  const browse = useMemo(
    () => ({ q, exact, category, source, collection, tag, level, status, favorite, free, broken, sort, country, trust, link: '', compare: '' }),
    [q, exact, category, source, collection, tag, level, status, favorite, free, broken, sort, country, trust],
  );
  const [addOpen, setAddOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [saveButtonOpen, setSaveButtonOpen] = useState(false);
  // "Find duplicates" from the owner's ••• menu: null until it's first opened, then open (true) or closed (false).
  const [duplicatesOpen, setDuplicatesOpen] = useState(null);
  const searchRef = useRef(null);
  const topSearchRef = useRef(null);
  const [stuck, setStuck] = useState(false); // the big search box has scrolled out of sight
  const queryClient = useQueryClient();
  const toast = useToast();

  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/me') });
  const owner = Boolean(me.data?.owner);
  const gated = Boolean(me.data?.private && !owner);
  const logout = useMutation({
    mutationFn: () => api('/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries();
      toast('Logged out');
    },
  });
  // A change was refused because you're logged out now (api.js): the login ran out, or you logged out in another tab.
  // A message offers to log in again, and the page drops its owner buttons. But not under an open window: that would
  // throw away what you typed there (a private library would even swap the whole page for its login page). So the
  // page waits until the last window has closed.
  useEffect(() => {
    const refreshMe = () => queryClient.invalidateQueries({ queryKey: ['me'] });
    const windowClosed = () => {
      if (document.querySelector('dialog[open]')) return;
      document.removeEventListener('close', windowClosed, true);
      refreshMe();
    };
    let said = null; // the message, and when it came: one failure can come with others, and one message is enough
    let saidAt = 0;
    const loginNeeded = () => {
      const inWindow = Boolean(document.querySelector('dialog[open]'));
      if (inWindow) document.addEventListener('close', windowClosed, true); // `close` doesn't bubble, so `true` is needed
      else refreshMe();
      if (Date.now() - saidAt < 8000) return;
      saidAt = Date.now();
      toast.dismiss(said);
      // A private library with no window open goes to its own login page right now, so no button is needed there.
      const gateNext = !inWindow && queryClient.getQueryData(['me'])?.private;
      said = toast({
        title: 'You’re logged out',
        description: 'Log in again to make changes.',
        tone: 'warning',
        action: gateNext ? undefined : { label: 'Log in', onClick: () => setLoginOpen(true) },
      });
    };
    window.addEventListener(LOGIN_NEEDED, loginNeeded);
    return () => {
      window.removeEventListener(LOGIN_NEEDED, loginNeeded);
      document.removeEventListener('close', windowClosed, true);
    };
  }, [queryClient, toast]);
  const links = useLinks(params);
  useKeepPlace(links, params);
  const busy = links.isFetching && !links.isFetchingNextPage;
  // The search's first page, for the top results in the panel under the search box. While the next search loads,
  // the last one stays there (faded) instead of blinking away; it only goes when the search is cleared.
  const lastPage = useRef(null);
  const freshPage = params.q && !links.isPlaceholderData ? links.data?.pages[0] : undefined;
  if (!params.q || links.isError) lastPage.current = null;
  else if (freshPage) lastPage.current = freshPage;
  const results = lastPage.current && { page: lastPage.current, loading: !freshPage };
  const phone = useMediaQuery(PHONE);
  const facets = useFacets(params);
  const [view, setView] = useView(Boolean(params.q));
  const [selecting, setSelecting] = useState(false); // picking links to change many at once
  // The "Pick links to compare" window: 'pick' (from the toolbar, on its own) or 'edit' (from the compare window's
  // "Add link", on top of it), or null while it's closed.
  const [picker, setPicker] = useState(null);
  const [mapOpen, setMapOpen] = useState(false); // the map, when it waits behind the toolbar's Map button
  // The results in the order they are shown, so the detail panel's arrows can go through them.
  const ids = useMemo(() => (links.data?.pages ?? []).flatMap(page => page.items.map(link => link.id)), [links.data]);
  // The first links on the page, in the order shown, for "On your screen" in the compare picker.
  const screenLinks = useMemo(() => (links.data?.pages ?? []).flatMap(page => page.items).slice(0, SCREEN_LINKS), [links.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = links;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useProgressPolling();
  useShortcuts({
    '/': () => (stuck ? topSearchRef : searchRef).current?.focus(),
    n: () => owner && !params.explore && setAddOpen(true), // the Explore map has its own keys
  });

  useEffect(() => {
    if (me.data?.title) document.title = me.data.title;
  }, [me.data?.title]);

  // Once the big search box hides under the top bar, a small one shows up in the top bar.
  useEffect(() => {
    const box = searchRef.current?.closest('form');
    if (!box) return;
    const header = document.querySelector('.app-header').offsetHeight;
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Typing in the small box and scrolled back up? Carry on in the big one.
        if (entry.isIntersecting && document.activeElement === topSearchRef.current) searchRef.current.focus({ preventScroll: true });
        setStuck(!entry.isIntersecting);
      },
      { rootMargin: `-${header}px 0px 0px 0px` },
    );
    observer.observe(box);
    return () => observer.disconnect();
  }, [gated]);

  // The big box scrolled away while you were in it (say, after Enter)? Carry on in the small one.
  useEffect(() => {
    if (stuck && document.activeElement === searchRef.current) topSearchRef.current?.focus({ preventScroll: true });
  }, [stuck]);

  // A new search or filter while you are down in the results: go back to the top of the results.
  const resultsKey = JSON.stringify(linkFilters(params));
  const lastResultsKey = useRef(resultsKey);
  useEffect(() => {
    if (lastResultsKey.current === resultsKey) return;
    lastResultsKey.current = resultsKey;
    scrollToResults();
  }, [resultsKey]);

  // ---------- The Stats page: a step of its own, so Back goes back to the library ----------
  // The library stays on the page (hidden) while Stats is open, so it comes back as it was, at the same place.
  // A click on the Stats page (a country, a category) shows the library with only that filter on, as a new step:
  // Back from there returns to the Stats page.
  const statsOpen = Boolean(params.stats);
  const libraryPlace = useRef(null); // { y, key }: where you were in the library, and its filters
  const pickedOnStats = useRef(false);
  const statsReady = useCallback(() => {
    loadStats().then(module => queryClient.prefetchQuery(module.statsQuery));
  }, [queryClient]);
  const openStats = useCallback(() => {
    const now = paramsRef.current;
    if (now.stats) return;
    libraryPlace.current = { y: window.scrollY, key: JSON.stringify(linkFilters(now)) };
    setParams({ stats: true, link: '', compare: '' }, 'stats');
  }, [setParams]);
  const closeStats = useCallback(() => {
    if (!paramsRef.current.stats) return;
    if (window.history.state?.step === 'stats') window.history.back();
    else setParams({ stats: false });
  }, [setParams]);
  const showFromStats = useCallback(
    changes => {
      pickedOnStats.current = true;
      setParams({ ...NO_FILTERS, ...changes, stats: false, link: '' }, 'stats-pick');
    },
    [setParams],
  );
  const wasStats = useRef(statsOpen);
  useLayoutEffect(() => {
    if (wasStats.current === statsOpen) return;
    wasStats.current = statsOpen;
    if (statsOpen) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    const place = libraryPlace.current;
    if (pickedOnStats.current) requestAnimationFrame(() => scrollToResults('top'));
    else if (place?.key === JSON.stringify(linkFilters(paramsRef.current))) window.scrollTo({ top: place.y, behavior: 'instant' });
    pickedOnStats.current = false;
  }, [statsOpen]);

  // ---------- The Explore map page: a step of its own too (?explore=1, &focus=<link> for the picked link) ----------
  // It covers the whole screen; the library stays where it was behind it. Explore.jsx handles its own steps and
  // its way back. `exploreFrom` is the spot clicked on the home map, so Explore can glide in toward it.
  const exploreOpen = Boolean(params.explore);
  const exploreFrom = useRef(null);
  const openExplore = useCallback(
    spot => {
      if (paramsRef.current.explore) return;
      exploreFrom.current = spot ?? null;
      setParams({ explore: true, focus: '', island: '', link: '', compare: '' }, 'explore');
    },
    [setParams],
  );
  // "Show in library" on the map: the library with only that category, as a new step, so Back returns to the map.
  const showFromExplore = useCallback(
    category => {
      setParams({ ...NO_FILTERS, category, explore: false, focus: '', island: '', link: '' }, 'explore-pick');
      requestAnimationFrame(() => scrollToResults('top'));
    },
    [setParams],
  );

  // Opening a link's details is a step of its own, so the Back button closes them again.
  // Opening one of a search's results means the search was worth keeping in your recent searches.
  const openLink = useCallback(
    id => {
      const now = paramsRef.current;
      if (now.q && !now.link) rememberSearch(now.q);
      // Only one window at a time: details replace a comparison (Back brings it back).
      setParams({ link: id, compare: '' }, now.link ? undefined : 'link');
    },
    [setParams],
  );
  const openAdd = useCallback(() => setAddOpen(true), []);
  const stopSelecting = useCallback(() => setSelecting(false), []);
  const openPicker = useCallback(() => setPicker('pick'), []);
  // The compare window closed under the picker that was changing it (Back, say): the picker goes too.
  useEffect(() => {
    if (picker === 'edit' && !params.compare) setPicker(null);
  }, [picker, params.compare]);
  // The links in the compare window (from the address bar). One link alone is nothing to compare.
  const compareIds = [...new Set(params.compare.split(',').filter(Boolean))].slice(0, MAX_COMPARE);
  if (compareIds.length < MIN_COMPARE) compareIds.length = 0;
  // An address with one link to compare (or the same link twice) opens nothing: it leaves the address bar,
  // and a short message says why, instead of nothing happening at all.
  // (Once per address: React's checks in development run an effect twice, which would say it twice.)
  const oneToCompare = params.compare && !compareIds.length ? params.compare : '';
  const clearedCompare = useRef('');
  useEffect(() => {
    if (!oneToCompare) clearedCompare.current = '';
    if (!oneToCompare || gated || clearedCompare.current === oneToCompare) return;
    clearedCompare.current = oneToCompare;
    setParams({ compare: '' });
    toast({ title: 'Pick at least 2 links to compare', tone: 'info' });
  }, [oneToCompare, gated, setParams, toast]);
  const filtersDone = useCallback(() => requestAnimationFrame(() => scrollToResults('low')), []);
  const toggleMap = useCallback(() => setMapOpen(open => !open), []);
  // No links at all yet: the examples and the toolbar have nothing to work on, so they wait for the first link.
  // (Not while the answer is on its way: a library with links never shows without them.)
  const empty = me.data?.total === 0;
  // The last link is gone: nothing is left to select, and the toolbar with its Select button is gone too.
  useEffect(() => {
    if (empty) stopSelecting();
  }, [empty, stopSelecting]);
  const map = useMemo(() => (phone ? { open: mapOpen, onToggle: toggleMap } : null), [phone, mapOpen, toggleMap]);

  // Which window is open. Going straight from one to the other (details ↔ compare, Back included, or the compare
  // picker → compare) swaps them without their open and close animations: no flash of the page, no doubled
  // darkness. The swap mark stays while that window is open, because taking it away would start the animation late.
  // (The picker on top of the compare window, to change its links, is not a window of its own here.)
  const openWindow = params.link ? 'link' : compareIds.length ? 'compare' : picker === 'pick' ? 'picker' : '';
  const windowState = useRef({ open: openWindow, swapped: false });
  if (windowState.current.open !== openWindow) {
    windowState.current = { open: openWindow, swapped: Boolean(windowState.current.open && openWindow) };
  }
  const swapped = windowState.current.swapped;

  if (gated) return <PrivateGate title={me.data.title} />;

  // The search box never moves: the title, the map and the examples stay while you search,
  // and Enter (or "See all" in the panel) brings the whole list up under it.
  const search = (q, show) => {
    setParams({ q, exact: false }, searchStep(params.q, q));
    if (show) {
      rememberSearch(q);
      requestAnimationFrame(() => scrollToResults('top'));
    }
  };
  const showTag = tag => {
    setParams({ tag, q: '', link: '' });
    requestAnimationFrame(() => scrollToResults('low'));
  };
  const toResults = () => {
    const first = document.querySelector('#results .card-open');
    first?.focus();
    return Boolean(first);
  };
  const searchBox = { value: params.q, results, busy, onSearch: search, onOpenLink: openLink, onTag: showTag, onDown: toResults };
  const closeLink = () => {
    if (!params.link) return;
    if (window.history.state?.step === 'link') window.history.back();
    else setParams({ link: '' });
  };
  // Only one window is open at a time, and Back walks back through them: details → compare → details → close.
  // Opening your picks as a comparison checks them out: the picks empty (the comparison is kept in "Recent
  // comparisons" instead), so the toolbar's number and the cards' "In compare" marks don't linger after you close
  // it. The window gets the picks' copies first, so it still opens filled. Other comparisons leave the picks alone.
  const openCompare = compareIds => {
    const picks = getPicks();
    if (picks.length && sameIds(picks.map(pick => pick.id), compareIds)) {
      const queryKey = ['compare', compareIds.join(',')];
      if (!queryClient.getQueryData(queryKey) && picks.every(link => Array.isArray(link.tags))) {
        const items = compareIds.map(id => picks.find(pick => pick.id === id));
        queryClient.setQueryData(queryKey, { items }, { updatedAt: 0 }); // marked old: the window still asks for fresh copies
      }
      clearPicks();
    }
    setParams({ compare: compareIds.join(','), link: '' }, 'compare');
  };
  const closeCompare = () => {
    if (!params.compare) return;
    if (window.history.state?.step === 'compare') window.history.back();
    else setParams({ compare: '' });
  };
  const openFromCompare = id => setParams({ link: id, compare: '' }, 'link');
  // The compare window's links changed (one taken out, or gone from the library). Fewer than 2 left closes the
  // window the way Back would, so the next Back goes where you came from.
  const changeCompare = newIds => {
    if (newIds.length < MIN_COMPARE) closeCompare();
    else setParams({ compare: newIds.join(',') });
  };
  // The picker opens the compare window (it closes itself without its fade then: see ComparePicker.jsx).
  const compareFromPicker = pickedIds => {
    setPicker(null);
    openCompare(pickedIds);
  };
  // The picker changed the compare window's links. Links taken out leave your picks too, like the window's own ×.
  const updateCompare = newIds => {
    removePicks(compareIds.filter(id => !newIds.includes(id)));
    if (newIds.join(',') !== compareIds.join(',')) setParams({ compare: newIds.join(',') });
    setPicker(null);
  };

  return (
    <>
      <a className="skip-link" href="#results">
        Skip to links
      </a>
      <Header
        me={me.data}
        search={stuck && !statsOpen && <SearchBar ref={topSearchRef} compact {...searchBox} />}
        statsOpen={statsOpen}
        onStats={statsOpen ? closeStats : openStats}
        onStatsReady={statsReady}
        onAdd={() => setAddOpen(true)}
        onLogin={() => setLoginOpen(true)}
        onLogout={() => logout.mutate()}
        onSaveButton={() => setSaveButtonOpen(true)}
        onDuplicates={() => setDuplicatesOpen(true)}
      />
      <main className="container page" id="links" style={statsOpen ? { display: 'none' } : undefined}>
        <section className="hero" aria-label="Search">
          <h2 className="hero-title">Find anything you saved by saying what you want to do.</h2>
          <SearchBar ref={searchRef} {...searchBox} examples={!empty} />
        </section>
        {/* On phones the map waits behind the toolbar's Map button, so your links come first. */}
        {!phone && <KnowledgeMap params={browse} onOpen={openLink} onExplore={openExplore} />}
        {/* The toolbar (with the chips of the filters that are on) sticks to the top while you scroll through
            the results, so this box holds both. */}
        <div className={`browse${empty ? ' is-empty' : ''}`} id="browse">
          {empty ? null : (
            <Toolbar
              params={browse}
              setParams={setParams}
              owner={owner}
              facets={facets}
              view={view}
              onView={setView}
              selecting={selecting}
              onSelecting={setSelecting}
              onCompare={openPicker}
              map={map}
              onFiltersDone={filtersDone}
            />
          )}
          {phone && mapOpen && !empty && <KnowledgeMap params={browse} panel onOpen={openLink} onExplore={openExplore} />}
          <LinkGrid
            params={browse}
            setParams={setParams}
            owner={owner}
            onOpen={openLink}
            onAdd={openAdd}
            view={view}
            selecting={selecting}
            onStopSelecting={stopSelecting}
          />
        </div>
      </main>
      {statsOpen ? (
        <Suspense fallback={null}>
          <StatsPage owner={owner} onBack={closeStats} onShow={showFromStats} onOpenLink={openLink} />
        </Suspense>
      ) : null}
      {exploreOpen ? (
        <Suspense fallback={null}>
          <Explore
            params={params}
            setParams={setParams}
            owner={owner}
            start={exploreFrom.current}
            onOpenLink={openLink}
            onCompare={openCompare}
            onShowCategory={showFromExplore}
          />
        </Suspense>
      ) : null}
      <LinkDrawer
        id={params.link}
        q={params.q}
        owner={owner}
        categories={me.data?.categories ?? []}
        ids={statsOpen || exploreOpen ? [] : ids}
        onClose={closeLink}
        onOpen={openLink}
        onNearEnd={loadMore}
        onCompare={openCompare}
        instant={swapped}
        onTag={tag => {
          setParams({ tag, link: '' });
          requestAnimationFrame(() => scrollToResults('low'));
        }}
      />
      <CompareWindow
        ids={compareIds}
        q={params.q}
        owner={owner}
        instant={swapped}
        onClose={closeCompare}
        onOpenLink={openFromCompare}
        onChangeIds={changeCompare}
        onEditLinks={() => setPicker('edit')}
      />
      {/* After the compare window, so in 'edit' it opens on top of it (and messages go to the window on top). */}
      <ComparePicker
        mode={picker === 'edit' && !compareIds.length ? null : picker}
        compareIds={compareIds}
        screenLinks={screenLinks}
        q={params.q}
        onClose={() => setPicker(null)}
        onCompare={compareFromPicker}
        onUpdate={updateCompare}
      />
      {owner && <AddDialog open={addOpen} onClose={() => setAddOpen(false)} />}
      {owner && <SaveButtonDialog open={saveButtonOpen} onClose={() => setSaveButtonOpen(false)} />}
      {owner && duplicatesOpen !== null ? (
        <Suspense fallback={null}>
          <Duplicates open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} />
        </Suspense>
      ) : null}
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <BackToTop />
    </>
  );
}
