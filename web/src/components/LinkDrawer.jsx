// The detail window: it opens in the middle of the screen with everything about one website on the left and,
// on the right, the links in your library that do the same job, its tags and the small facts.
// The arrows (or the ← → keys) go through the results without closing it. The links next to it are loaded
// ahead, and the one on screen stays (a little faded) until the next one is ready, so nothing blinks.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, ExternalLink, Copy, Pencil, Trash2, Star, Check, Unlink, LoaderCircle, Folder, CircleAlert, ArrowRight, Search, FileText,
  ChevronLeft, ChevronRight, ChevronDown, Globe, Columns3,
} from 'lucide-react';
import { api, toQuery } from '../api.js';
import { CategoryBadge, categoryStyle, hueOf } from '../categories.jsx';
import { Dropdown } from './Popover.jsx';
import { Preview, FavoriteButton, SiteIcon } from './LinkCard.jsx';
import Highlight from './Highlight.jsx';
import { useToast } from './Toasts.jsx';
import { useConfirm } from './Confirm.jsx';
import { patchLinks, useUpdateLink, useCountOpen } from '../hooks.js';
import { MAX_COMPARE, togglePick, useComparePicks } from '../compare.js';
import FactsTabs, { Glance, factsQuery, useLinkFacts } from './facts/FactsTabs.jsx';
import {
  compactNumber, fullDate, hostOf, timeAgo, PRICING_LABELS, STATUS_LABELS, LEVEL_LABELS, MY_STATUS_LABELS, isWorking,
} from '../format.js';
import './detail.css';

const SHOWN_FEATURES = 5;
const SHOWN_HEADINGS = 10;
const DISCARD = { title: 'Throw away your changes?', message: 'What you typed in the form will be lost.', confirmLabel: 'Throw away', danger: true };

// The same key and request everywhere, so a link loaded ahead is found again when you reach it.
export const detailQuery = (id, q) => ({ queryKey: ['link', id, q], queryFn: () => api(`/links/${id}?${toQuery({ q })}`) });

const exactTime = date => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date));
const times = n => `${n} ${n === 1 ? 'time' : 'times'}`;
const splitList = (text, by) => text.split(by).map(item => item.trim()).filter(Boolean);

// The part of the address after the website's name, or nothing for its home page.
function pathOf(url) {
  try {
    const { pathname } = new URL(url);
    return pathname.length > 1 ? pathname : '';
  } catch {
    return '';
  }
}

// To try / Using / Done. Click the chosen one again to clear it.
function MyStatus({ link, owner }) {
  const update = useUpdateLink();
  if (!owner) {
    return MY_STATUS_LABELS[link.myStatus] ? <span className="pill pill-status detail-status-pill">{MY_STATUS_LABELS[link.myStatus]}</span> : null;
  }
  return (
    <div className="segmented segmented-text detail-status" role="group" aria-label="Your status">
      {Object.entries(MY_STATUS_LABELS).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={link.myStatus === value}
          onClick={() => update.mutate({ link, changes: { myStatus: link.myStatus === value ? '' : value } })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// `action` is a small button at the right of the section's title ("Compare all").
function Section({ title, action, children }) {
  return (
    <section className="detail-section">
      {action ? (
        <div className="detail-section-head">
          <h3>{title}</h3>
          {action}
        </div>
      ) : (
        <h3>{title}</h3>
      )}
      {children}
    </section>
  );
}

// Puts this link in the compare tray, or takes it out. Once 4 links are picked, a fifth can't be added.
// After adding, a message offers "Compare now" when there are 2 or more.
function CompareToggle({ link, onCompare }) {
  const picks = useComparePicks();
  const toast = useToast();
  const inCompare = picks.some(pick => pick.id === link.id);
  const full = !inCompare && picks.length >= MAX_COMPARE;
  return (
    <button
      type="button"
      className={`btn btn-ghost detail-compare${inCompare ? ' is-on' : ''}${full ? ' is-full' : ''}`}
      aria-pressed={inCompare}
      aria-disabled={full || undefined}
      title={full ? 'You can compare up to 4 links' : inCompare ? 'Take it out of compare' : 'Add to compare'}
      onClick={() => {
        if (full) return;
        togglePick(link);
        if (inCompare) return;
        const ids = [...picks.map(pick => pick.id), link.id];
        toast({
          title: 'Added to compare',
          description: `${ids.length} of ${MAX_COMPARE} picked`,
          tone: 'info',
          action: ids.length >= 2 ? { label: 'Compare now', onClick: () => onCompare(ids) } : undefined,
        });
      }}
    >
      {inCompare ? <Check size={17} aria-hidden="true" /> : <Columns3 size={17} aria-hidden="true" />}
      {inCompare ? 'In compare' : 'Compare'}
    </button>
  );
}

// A list that shows its first few items, with a button for the rest.
function ShortList({ items, shown, className, render }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className={className}>{(all ? items : items.slice(0, shown)).map(render)}</ul>
      {items.length > shown && (
        <button type="button" className="detail-link-btn" onClick={() => setAll(!all)}>
          {all ? 'Show less' : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

// The link as the list (or the compare window) already has it, so a fresh open shows the name, picture, summary and
// the rest at once; only "Similar" and the extra details wait for the server. `similar: null` marks it.
function knownLink(queryClient, id) {
  if (!id) return undefined;
  for (const key of ['links', 'compare', 'link']) {
    for (const [, data] of queryClient.getQueriesData({ queryKey: [key] })) {
      // A list's pages, the compare window's links, or another details window's similar links.
      const items = data?.pages ? data.pages.flatMap(page => page.items) : (data?.items ?? data?.similar ?? []);
      const link = items.find(item => item.id === id);
      if (link) return { link, similar: null };
    }
  }
  return undefined;
}

// Grey shapes in the window's layout, only for the very first open when there is nothing to show yet.
function Skeleton({ side = false }) {
  if (side) {
    return (
      <div className="detail-skeleton" aria-hidden="true">
        <span className="is-pill" />
        <span className="is-row" />
        <span className="is-row" />
        <span className="is-row" />
      </div>
    );
  }
  return (
    <div className="detail-skeleton">
      <span className="is-hero" aria-hidden="true" />
      <span className="is-pill" aria-hidden="true" />
      <span className="is-title" aria-hidden="true" />
      <span className="is-text" aria-hidden="true" />
      <span className="is-text is-short" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

const formFrom = link => ({
  title: link.title,
  category: link.category,
  tags: link.tags.join(', '),
  collection: link.collection,
  note: link.note,
  summary: link.summary,
  tasks: link.tasks.join('\n'),
});

// `onDirty` tells the window whether there are unsaved changes, so closing or moving on asks first.
function EditForm({ link, categories, onDone, onDirty }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const titleRef = useRef(null);
  const [form, setForm] = useState(() => formFrom(link));
  const [titleError, setTitleError] = useState('');
  const dirty = JSON.stringify(form) !== JSON.stringify(formFrom(link));
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

  const save = useMutation({
    mutationFn: () =>
      api(`/links/${link.id}`, {
        method: 'PATCH',
        body: { ...form, title: form.title.trim(), tags: splitList(form.tags, ','), tasks: splitList(form.tasks, '\n') },
      }),
    onSuccess: ({ link: saved }) => {
      patchLinks(queryClient, [saved]);
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      toast('Changes saved');
      onDone();
    },
  });
  const field = key => ({ value: form[key], onChange: event => setForm({ ...form, [key]: event.target.value }) });
  // The link's own category stays in the list even when it isn't one of the library's categories any more.
  const options = [...new Set([link.category, ...categories])].filter(Boolean).map(name => ({ value: name, label: name, Icon: categoryStyle(name).Icon }));

  const submit = event => {
    event.preventDefault();
    if (!form.title.trim()) {
      setTitleError('Give this link a name.');
      titleRef.current?.focus();
      return;
    }
    save.mutate();
  };
  const cancel = async () => {
    if (dirty && !(await confirm(DISCARD))) return;
    onDone();
  };

  return (
    <form className="detail-form" noValidate onSubmit={submit}>
      <div className="detail-form-head">
        <h2>Edit this link</h2>
        <span className="hint">{hostOf(link.url)}</span>
      </div>
      <label>
        Title
        <input
          ref={titleRef}
          className="input"
          maxLength={200}
          value={form.title}
          aria-invalid={titleError ? 'true' : undefined}
          aria-describedby={titleError ? 'detail-title-error' : undefined}
          onChange={event => {
            setForm({ ...form, title: event.target.value });
            if (titleError && event.target.value.trim()) setTitleError('');
          }}
        />
        {titleError && (
          <span className="field-error" id="detail-title-error" role="alert">
            {titleError}
          </span>
        )}
      </label>
      <div className="detail-form-row">
        <div className="detail-field">
          Category
          <Dropdown title="Category" className="detail-dropdown" value={form.category} options={options} onChange={category => setForm({ ...form, category })} />
        </div>
        <label>
          Collection <span className="hint">optional</span>
          <input className="input" maxLength={80} {...field('collection')} placeholder="Video tools" />
        </label>
      </div>
      <label>
        Tags <span className="hint">separate with commas</span>
        <input className="input" {...field('tags')} placeholder="video, free, editing" />
      </label>
      <label>
        Summary <span className="hint">up to 1000 letters</span>
        <textarea className="input" rows={3} maxLength={1000} {...field('summary')} />
      </label>
      <label>
        What you can do with it <span className="hint">one per line, helps search find it</span>
        <textarea className="input" rows={4} {...field('tasks')} placeholder={'convert PDF to Excel\nmerge PDFs'} />
      </label>
      <label>
        Your note <span className="hint">helps search find it</span>
        <textarea className="input" rows={2} maxLength={1000} {...field('note')} placeholder="Why you saved this" />
      </label>
      {save.isError && <p className="form-error">{save.error.message}</p>}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// `ids` are the results on screen, in order, so the arrows can go to the one before or after.
// `onNearEnd` loads more results when you reach the last ones.
// `instant`: the window swaps in without its fade (coming straight from the compare window).
export default function LinkDrawer({ id, q, owner, categories, ids = [], onClose, onOpen, onTag, onNearEnd, onCompare, instant = false }) {
  const ref = useRef(null);
  const bodyRef = useRef(null);
  const mainRef = useRef(null);
  const sideRef = useRef(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const countOpen = useCountOpen();
  const [editing, setEditing] = useState(false);
  const dirty = useRef(false); // the edit form has unsaved changes
  const setDirty = useCallback(value => {
    dirty.current = value;
  }, []);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  const shown = useRef(false); // a link was on screen during the last render
  // The facts tab stays the same while you go through the results with the arrows, so you can compare them.
  const [tab, setTab] = useState('overview');
  const factsRef = useRef(null);

  const position = ids.indexOf(id);
  const previous = position > 0 ? ids[position - 1] : null;
  const next = position >= 0 && position < ids.length - 1 ? ids[position + 1] : null;
  const hasNav = position >= 0 && ids.length > 1;

  // With a search, the server also says where its words appear on the website.
  // Moving to another link keeps the one on screen until the new one arrives. A fresh open shows what the list
  // already knows about the link at once, and the skeleton only when the link isn't in it.
  const detail = useQuery({
    ...detailQuery(id, q),
    enabled: Boolean(id),
    placeholderData: old => (shown.current ? old : knownLink(queryClient, id)),
  });
  const link = detail.data?.link;
  const similarLoading = detail.data?.similar === null; // shown from the list; the similar links are on their way
  const similar = detail.data?.similar ?? [];
  const switching = detail.isPlaceholderData && !similarLoading;
  useEffect(() => {
    shown.current = Boolean(id && link);
  });
  const facts = useLinkFacts(id, owner);
  // Only this link's facts: while the next link loads, the one on screen doesn't get its chips.
  const factsData = link?.id === id ? facts.data : undefined;
  useEffect(() => {
    if (!id) setTab('overview');
  }, [id]);
  const pickTab = useCallback(to => {
    setTab(to);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    factsRef.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, []);

  useEffect(() => {
    if (position >= 0 && position >= ids.length - 3) onNearEnd?.();
  }, [position, ids.length, onNearEnd]);

  // The window opens and closes before the screen is drawn, so going straight to or from the compare window
  // happens in one frame.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (id && !dialog.open) dialog.showModal();
    if (!id && dialog.open) dialog.close();
  }, [id]);
  useEffect(() => {
    setEditing(false);
    setCopied(false);
    // Opening a link counts as using it, so the ones you use most come up first in search.
    if (id && owner) countOpen(id);
  }, [id, owner, countOpen]);

  // Each new link starts at the top of both columns (and of the whole window on small screens).
  useLayoutEffect(() => {
    for (const column of [bodyRef, mainRef, sideRef]) column.current?.scrollTo?.(0, 0);
  }, [id]);

  // The links on either side are loaded ahead, pictures included, so the arrows feel instant.
  useEffect(() => {
    if (!id) return;
    for (const other of [next, previous]) {
      if (!other) continue;
      const query = detailQuery(other, q);
      queryClient.prefetchQuery(factsQuery(other));
      queryClient.prefetchQuery(query).then(() => {
        const url = queryClient.getQueryData(query.queryKey)?.link.imageUrl;
        if (url) Object.assign(new Image(), { referrerPolicy: 'no-referrer', src: url });
      });
    }
  }, [id, next, previous, q, queryClient]);

  // Anything that leaves the link (another link, a tag, closing) asks first when the edit form has unsaved changes.
  const leave = useCallback(
    async action => {
      if (editing && dirty.current && !(await confirm(DISCARD))) return;
      setEditing(false);
      action();
    },
    [editing, confirm],
  );
  const go = useCallback(to => to && leave(() => onOpen(to)), [leave, onOpen]);
  const close = () => leave(onClose);

  // ← → and Esc on the keyboard. Listening on the page (not the window) keeps them working after a click removed
  // the focused button, like a row in the "Similar" list that is gone once the next link shows. Esc is handled
  // here too, so closing always goes through `close` (and its unsaved-changes question) in every browser.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!id) return;
    const onKey = event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.target !== document.body && !ref.current.contains(event.target)) return; // another window has the keys
      if (document.querySelectorAll('dialog[open]').length > 1) return; // a question is open on top of this window
      if (event.key === 'Escape') {
        if (event.target.closest?.('[aria-expanded="true"], [role="listbox"]')) return; // Esc closes that menu first
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (editing || event.target.closest?.('input, textarea, select, [contenteditable]')) return;
      const to = event.key === 'ArrowLeft' ? previous : next;
      if (to) {
        event.preventDefault();
        go(to);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, editing, previous, next, go]);

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Hidden on 2026-10-28: a periodic background refresh is planned instead.
  // Needs `trackLinks` from ../hooks.js and `RefreshCw` from lucide-react when it comes back.
  // const refresh = useMutation({
  //   mutationFn: () => api(`/links/${id}/refresh`, { method: 'POST' }),
  //   onSuccess: ({ link: queued }) => {
  //     trackLinks([queued]);
  //     patchLinks(queryClient, [queued]);
  //     toast('Reading the page again…');
  //   },
  //   onError: error => toast(error.message, 'error'),
  // });
  // <button type="button" className="icon-btn" title="Read the page again and rewrite the summary" aria-label="Refresh summary"
  //   onClick={() => refresh.mutate()} disabled={refresh.isPending || isWorking(link)}>
  //   <RefreshCw size={18} />
  // </button>

  const remove = useMutation({
    mutationFn: () => api(`/links/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['link', id] });
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['map'] });
      toast('Link deleted');
      onClose();
    },
    onError: error => toast(error.message, 'error'),
  });

  async function removeLink() {
    const sure = await confirm({
      title: 'Delete this link?',
      message: `“${link.title}” will be removed from your library. This can’t be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (sure) remove.mutate();
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Couldn’t copy. Select the address and copy it instead.', 'error');
    }
  }

  const path = link ? pathOf(link.url) : '';
  const headings = link?.headings?.filter(heading => heading !== link.title) ?? [];
  const hasMore = Boolean(link && (link.pageLinks?.length || headings.length || link.pagesRead?.length || link.searchWords?.length));

  return (
    <dialog
      ref={ref}
      className={`detail${instant ? ' is-instant' : ''}`}
      aria-label={link ? link.title : 'Link details'}
      onClose={onClose}
      onCancel={event => {
        // Esc: ask about unsaved changes before the window goes.
        if (editing && dirty.current) {
          event.preventDefault();
          close();
        }
      }}
      onClick={event => event.target === ref.current && close()}
    >
      {/* `id ? … : null`, not `id && …`: an empty id would become an empty text child, and React then clears the
          whole window with textContent, messages placed in it included (see Toasts.jsx). */}
      {id ? (
        <>
          <div className="detail-window" aria-busy={switching || undefined}>
            {switching && <div className="detail-progress" aria-hidden="true" />}

            <header className="detail-top">
              {hasNav && (
                <nav className="detail-nav" aria-label="Results">
                  <button type="button" className="icon-btn" onClick={() => go(previous)} disabled={!previous} aria-label="Previous result" title="Previous result (←)">
                    <ChevronLeft size={20} />
                  </button>
                  <span className="detail-pos">
                    {position + 1} <span>of</span> {ids.length}
                  </span>
                  <button type="button" className="icon-btn" onClick={() => go(next)} disabled={!next} aria-label="Next result" title="Next result (→)">
                    <ChevronRight size={20} />
                  </button>
                </nav>
              )}
              <button type="button" className="icon-btn detail-close" onClick={close} aria-label="Close details" title="Close (Esc)">
                <X size={20} />
              </button>
            </header>

            <div className="detail-body" ref={bodyRef}>
              <article className="detail-main" ref={mainRef}>
                {link ? (
                  <>
                    {/* A new key per link: a picture that failed for one link must not hide the next one's. */}
                    <div className="detail-hero">
                      <Preview key={link.id} link={link} big />
                    </div>

                    {editing ? (
                      <EditForm key={link.id} link={link} categories={categories} onDone={() => setEditing(false)} onDirty={setDirty} />
                    ) : (
                      <>
                        <div className="detail-pills">
                          <CategoryBadge name={link.category} />
                          {PRICING_LABELS[link.pricing] && <span className="pill">{PRICING_LABELS[link.pricing]}</span>}
                          {LEVEL_LABELS[link.level] && <span className="pill">{LEVEL_LABELS[link.level]}</span>}
                          {isWorking(link) && (
                            <span className="pill pill-accent">
                              <LoaderCircle size={13} className="spin" aria-hidden="true" /> {STATUS_LABELS[link.status]}
                            </span>
                          )}
                        </div>
                        <h2 className="detail-title">{link.title}</h2>
                        <p className="detail-where">
                          <a className="detail-url" href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                            <Globe size={14} aria-hidden="true" />
                            <span className="detail-host">{hostOf(link.url)}</span>
                            {path && <span className="detail-path">{path}</span>}
                          </a>
                          <span className="detail-when" title={`Added ${exactTime(link.createdAt)}`}>
                            Added <time dateTime={link.createdAt}>{fullDate(link.createdAt)}</time>
                          </span>
                          {link.opens > 0 && <span className="detail-when">Opened {times(link.opens)}</span>}
                        </p>
                        <Glance
                          link={link}
                          data={factsData}
                          loading={link.source === 'web' && (!factsData || factsData.collecting || (owner && factsData.pending.length > 0))}
                          onPick={pickTab}
                        />

                        <div className="detail-actions">
                          <a className="btn btn-primary" href={link.url} target="_blank" rel="noopener noreferrer" onClick={() => owner && countOpen(link.id)}>
                            <ExternalLink size={17} aria-hidden="true" /> Open website
                          </a>
                          <button
                            type="button"
                            className={`icon-btn${copied ? ' detail-copied' : ''}`}
                            onClick={copyLink}
                            aria-label={copied ? 'Copied' : 'Copy link'}
                            title={copied ? 'Copied' : 'Copy link'}
                          >
                            {copied ? <Check size={18} /> : <Copy size={18} />}
                          </button>
                          <FavoriteButton link={link} owner={owner} className="icon-btn" />
                          <CompareToggle link={link} onCompare={compareIds => leave(() => onCompare(compareIds))} />
                          {owner && (
                            <>
                              <button type="button" className="icon-btn" title="Edit" aria-label="Edit" onClick={() => setEditing(true)}>
                                <Pencil size={18} />
                              </button>
                              <button type="button" className="icon-btn danger" title="Delete" aria-label="Delete" onClick={removeLink} disabled={remove.isPending}>
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </div>

                        <MyStatus link={link} owner={owner} />

                        <FactsTabs
                          link={link}
                          owner={owner}
                          data={factsData}
                          tab={tab}
                          onTab={setTab}
                          tabsRef={factsRef}
                          overview={
                            <>
                              {link.summary && <p className="detail-summary">{link.summary}</p>}
                              {link.snippet && (
                                <p className="detail-match" title="Where your search words appear">
                                  <Search size={15} aria-hidden="true" />
                                  <span>
                                    <Highlight text={link.snippet} />
                                  </span>
                                </p>
                              )}
                              {link.useFor && <p className="detail-use">{link.useFor}</p>}
                              {owner && link.aiStatus === 'basic' && !isWorking(link) && (
                                <p className="hint-box">This is a basic description from the page. Add a free Groq key to get AI summaries.</p>
                              )}
                              {link.aiStatus === 'pending' && !isWorking(link) && (
                                <p className="hint-box">The free AI is resting. A better summary will be added automatically later.</p>
                              )}
                              {link.status === 'failed' && (
                                <p className="hint-box warn" title={link.error || undefined}>
                                  <CircleAlert size={16} aria-hidden="true" /> The robot couldn’t read this page. It will try again on its own later.
                                </p>
                              )}
                              {link.health === 'broken' && (
                                <p className="hint-box warn">
                                  <Unlink size={16} aria-hidden="true" /> The page seems to be gone.
                                </p>
                              )}

                              {link.note && (
                                <Section title="Your note">
                                  <p className="detail-note">{link.note}</p>
                                </Section>
                              )}

                              {link.tasks.length > 0 && (
                                <Section title="What you can do with it">
                                  <ul className="detail-tasks">
                                    {link.tasks.map((task, index) => (
                                      <li key={`${index}-${task}`}>
                                        <ArrowRight size={15} aria-hidden="true" /> {task.charAt(0).toUpperCase() + task.slice(1)}
                                      </li>
                                    ))}
                                  </ul>
                                </Section>
                              )}

                              {link.features.length > 0 && (
                                <Section title="Key features">
                                  <ShortList
                                    key={link.id}
                                    items={link.features}
                                    shown={SHOWN_FEATURES}
                                    className="detail-features"
                                    render={(feature, index) => (
                                      <li key={`${index}-${feature}`}>
                                        <Check size={16} aria-hidden="true" /> {feature}
                                      </li>
                                    )}
                                  />
                                </Section>
                              )}

                              {link.quickStart?.length > 0 && (
                                <Section title="Quick start">
                                  <ol className="detail-steps">
                                    {link.quickStart.map((step, index) => (
                                      <li key={`${index}-${step}`}>{step}</li>
                                    ))}
                                  </ol>
                                </Section>
                              )}

                              {(link.overview || link.audience) && (
                                <Section title="In more detail">
                                  {link.overview && <p className="detail-overview">{link.overview}</p>}
                                  {link.audience && (
                                    <p className="detail-audience">
                                      <strong>Who it’s for:</strong> {link.audience}
                                    </p>
                                  )}
                                </Section>
                              )}
                            </>
                          }
                        />
                      </>
                    )}
                  </>
                ) : detail.isError ? (
                  <div className="detail-error" role="alert">
                    <CircleAlert size={22} aria-hidden="true" />
                    <p>{detail.error.message}</p>
                    <button type="button" className="btn btn-ghost" onClick={close}>
                      Close
                    </button>
                  </div>
                ) : (
                  <Skeleton />
                )}
              </article>

              <aside className="detail-side" ref={sideRef} aria-label="Related">
                {link ? (
                  <>
                    <Section
                      title="Similar in your library"
                      action={
                        similar.length > 0 && (
                          <button
                            type="button"
                            className="detail-compare-all"
                            onClick={() => leave(() => onCompare([link.id, ...similar.slice(0, MAX_COMPARE - 1).map(other => other.id)]))}
                            title="See this link and the similar ones side by side"
                          >
                            <Columns3 size={14} aria-hidden="true" /> Compare all
                          </button>
                        )
                      }
                    >
                      {similar.length > 0 ? (
                        <ul className="detail-similar">
                          {similar.map(other => (
                            <li key={other.id} style={hueOf(other.category)}>
                              <button type="button" onClick={() => go(other.id)} title={other.title}>
                                <SiteIcon link={other} />
                                <span className="detail-similar-text">
                                  <strong>{other.title}</strong>
                                  <span>{other.summary || other.description || hostOf(other.url)}</span>
                                </span>
                                <ChevronRight size={16} aria-hidden="true" className="detail-similar-go" />
                              </button>
                              {/* A sibling of the row (not inside it): a button can't hold another button. */}
                              <button
                                type="button"
                                className="detail-similar-compare"
                                onClick={() => leave(() => onCompare([link.id, other.id]))}
                                aria-label={`Compare ${link.title} with ${other.title}`}
                                title={`Compare with ${other.title}`}
                              >
                                <Columns3 size={15} aria-hidden="true" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : similarLoading ? (
                        <Skeleton side />
                      ) : (
                        <p className="detail-empty">Nothing similar saved yet.</p>
                      )}
                    </Section>

                    {link.tags.length > 0 && (
                      <Section title="Tags">
                        <div className="detail-tags">
                          {link.tags.map(tag => (
                            <button key={tag} type="button" className="detail-tag" onClick={() => leave(() => onTag(tag))} title={`All links tagged ${tag}`}>
                              #{tag}
                            </button>
                          ))}
                        </div>
                      </Section>
                    )}

                    <Section title="Details">
                      <dl className="detail-facts">
                        <dt>Added</dt>
                        <dd>
                          <time dateTime={link.createdAt}>{exactTime(link.createdAt)}</time>
                        </dd>
                        {link.collection && (
                          <>
                            <dt>Collection</dt>
                            <dd>
                              <Folder size={14} aria-hidden="true" /> {link.collection}
                            </dd>
                          </>
                        )}
                        {link.siteName && (
                          <>
                            <dt>Website</dt>
                            <dd>{link.siteName}</dd>
                          </>
                        )}
                        {link.opens > 0 && (
                          <>
                            <dt>Opened</dt>
                            <dd>
                              {times(link.opens)}
                              {link.openedAt && `, last ${timeAgo(link.openedAt)}`}
                            </dd>
                          </>
                        )}
                        {link.github && (
                          <>
                            <dt>GitHub</dt>
                            <dd>
                              <span>
                                <Star size={14} aria-hidden="true" /> {compactNumber(link.github.stars)} stars
                                {link.github.language && ` · ${link.github.language}`}
                                {link.github.license && ` · ${link.github.license}`}
                              </span>
                              {link.github.pushedAt && <span className="detail-sub">Updated {timeAgo(link.github.pushedAt)}</span>}
                            </dd>
                          </>
                        )}
                      </dl>
                    </Section>

                    {hasMore && (
                      <details key={link.id} className="detail-more">
                        <summary>
                          More <ChevronDown size={16} aria-hidden="true" />
                        </summary>
                        {link.pageLinks?.length > 0 && (
                          <Section title="Important links">
                            <div className="detail-page-links">
                              {link.pageLinks.map((item, index) => (
                                <a key={`${index}-${item.url}`} href={item.url} target="_blank" rel="noopener noreferrer">
                                  {item.label} <ExternalLink size={13} aria-hidden="true" />
                                </a>
                              ))}
                            </div>
                          </Section>
                        )}
                        {headings.length > 0 && (
                          <Section title="What’s on the website">
                            <ShortList
                              items={headings}
                              shown={SHOWN_HEADINGS}
                              className="detail-headings"
                              render={(heading, index) => <li key={`${index}-${heading}`}>{heading}</li>}
                            />
                          </Section>
                        )}
                        {link.pagesRead?.length > 0 && (
                          <Section title="Pages read">
                            <div className="detail-pages">
                              {link.pagesRead.map((page, index) => (
                                <a key={`${index}-${page.url}`} href={page.url} target="_blank" rel="noopener noreferrer">
                                  <FileText size={13} aria-hidden="true" /> {page.label || page.title || hostOf(page.url)}
                                </a>
                              ))}
                            </div>
                          </Section>
                        )}
                        {link.searchWords?.length > 0 && (
                          <Section title="Also found by">
                            <p className="detail-words">{link.searchWords.join(', ')}</p>
                          </Section>
                        )}
                      </details>
                    )}
                  </>
                ) : (
                  <Skeleton side />
                )}
              </aside>
            </div>
          </div>

          {/* On wide screens the arrows also float outside the window, like a photo viewer.
              The ones in the top bar do the same job for the keyboard and screen readers. */}
          {hasNav && (
            <>
              <button type="button" className="detail-float detail-float-prev" onClick={() => go(previous)} disabled={!previous} aria-hidden="true" tabIndex={-1}>
                <ChevronLeft size={26} />
              </button>
              <button type="button" className="detail-float detail-float-next" onClick={() => go(next)} disabled={!next} aria-hidden="true" tabIndex={-1}>
                <ChevronRight size={26} />
              </button>
            </>
          )}
        </>
      ) : null}
    </dialog>
  );
}
