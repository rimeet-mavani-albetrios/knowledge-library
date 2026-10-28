import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Lock } from 'lucide-react';
import { api } from './api.js';
import { useUrlState, useProgressPolling, useShortcuts, searchStep, useMediaQuery, PHONE, rememberSearch, useView } from './hooks.js';
import { linkFilters, useLinks } from './useLinks.js';
import Header from './components/Header.jsx';
import SearchBar from './components/SearchBar.jsx';
import Toolbar from './components/Toolbar.jsx';
import { ActiveFilters, useFacets } from './components/Filters.jsx';
import LinkGrid from './components/LinkGrid.jsx';
import KnowledgeMap from './components/KnowledgeMap.jsx';
import LinkDrawer from './components/LinkDrawer.jsx';
import AddDialog from './components/AddDialog.jsx';
import SaveButtonDialog from './components/SaveButtonDialog.jsx';
import LoginDialog, { LoginForm } from './components/LoginDialog.jsx';
import { LogoMark } from './components/Icons.jsx';
import { useToast } from './components/Toasts.jsx';

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
  const [addOpen, setAddOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [saveButtonOpen, setSaveButtonOpen] = useState(false);
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
  const links = useLinks(params);
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
  const [mapOpen, setMapOpen] = useState(false); // the map, when it waits behind the toolbar's Map button
  // The results in the order they are shown, so the detail panel's arrows can go through them.
  const ids = useMemo(() => (links.data?.pages ?? []).flatMap(page => page.items.map(link => link.id)), [links.data]);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = links;
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  useProgressPolling();
  useShortcuts({
    '/': () => (stuck ? topSearchRef : searchRef).current?.focus(),
    n: () => owner && setAddOpen(true),
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
  // Opening a link's details is a step of its own, so the Back button closes them again.
  const showLink = id => setParams({ link: id }, params.link ? undefined : 'link');
  // Opening one of a search's results means the search was worth keeping in your recent searches.
  const openLink = id => {
    if (params.q && !params.link) rememberSearch(params.q);
    showLink(id);
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

  return (
    <>
      <a className="skip-link" href="#results">
        Skip to links
      </a>
      <Header
        me={me.data}
        search={stuck && <SearchBar ref={topSearchRef} compact {...searchBox} />}
        onAdd={() => setAddOpen(true)}
        onLogin={() => setLoginOpen(true)}
        onLogout={() => logout.mutate()}
        onSaveButton={() => setSaveButtonOpen(true)}
      />
      <main className="container page" id="links">
        <section className="hero" aria-label="Search">
          <h2 className="hero-title">Find anything you saved by saying what you want to do.</h2>
          <SearchBar ref={searchRef} {...searchBox} />
        </section>
        {/* On phones the map waits behind the toolbar's Map button, so your links come first. */}
        {!phone && <KnowledgeMap params={params} onOpen={openLink} />}
        {/* The toolbar sticks to the top while you scroll through the results, so this box holds both. */}
        <div className="browse" id="browse">
          <Toolbar
            params={params}
            setParams={setParams}
            owner={owner}
            facets={facets}
            view={view}
            onView={setView}
            selecting={selecting}
            onSelecting={setSelecting}
            map={phone ? { open: mapOpen, onToggle: () => setMapOpen(!mapOpen) } : null}
            onFiltersDone={() => requestAnimationFrame(() => scrollToResults('low'))}
          />
          {phone && mapOpen && <KnowledgeMap params={params} panel onOpen={openLink} />}
          <LinkGrid
            params={params}
            setParams={setParams}
            owner={owner}
            onOpen={openLink}
            onAdd={() => setAddOpen(true)}
            view={view}
            selecting={selecting}
            onStopSelecting={() => setSelecting(false)}
            chips={<ActiveFilters params={params} setParams={setParams} owner={owner} />}
          />
        </div>
      </main>
      <LinkDrawer
        id={params.link}
        q={params.q}
        owner={owner}
        categories={me.data?.categories ?? []}
        ids={ids}
        onClose={closeLink}
        onOpen={openLink}
        onNearEnd={loadMore}
        onTag={tag => {
          setParams({ tag, link: '' });
          requestAnimationFrame(() => scrollToResults('low'));
        }}
      />
      {owner && <AddDialog open={addOpen} onClose={() => setAddOpen(false)} />}
      {owner && <SaveButtonDialog open={saveButtonOpen} onClose={() => setSaveButtonOpen(false)} />}
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
      <BackToTop />
    </>
  );
}
