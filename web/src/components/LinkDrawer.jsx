// The detail window: a calm profile of one website. A slim bar on top keeps the main actions in reach (favorite,
// copy, compare, open the website). Under it the whole window scrolls as one: the picture, the name and the key
// facts first, then the tabs with everything about the website, and beside them the links in your library that do
// the same job, its tags and the small facts.
// The arrows (or the ← → keys) go through the results without closing it. The links next to it are loaded
// ahead, and the one on screen stays (a little faded) until the next one is ready, so nothing blinks.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  X, ExternalLink, Copy, Pencil, Trash2, Star, Check, Unlink, LoaderCircle, Folder, CircleAlert, ArrowRight, Search, FileText,
  ChevronLeft, ChevronRight, Columns3, Ellipsis, Lightbulb,
} from 'lucide-react';
import { api, toQuery } from '../api.js';
import { CategoryBadge, categoryStyle, hueOf } from '../categories.jsx';
import { Dropdown, Popover } from './Popover.jsx';
import { Preview, FavoriteButton, SiteIcon } from './LinkCard.jsx';
import { SeeMore, Reveal } from './SeeMore.jsx';
import Highlight from './Highlight.jsx';
import { useToast } from './Toasts.jsx';
import { useConfirm } from './Confirm.jsx';
import { holdBack, patchLinks, useUpdateLink, useCountOpen } from '../hooks.js';
import { MAX_COMPARE, togglePick, useComparePicks } from '../compare.js';
import { isHidden, useDeleteLater, useHiddenLinks } from '../deleteLater.js';
import TagInput from './TagInput.jsx';
import FactsTabs, { Glance, factsBusy, factsQuery, useLinkFacts } from './facts/FactsTabs.jsx';
import {
  compactNumber, fullDate, hostOf, timeAgo, PRICING_LABELS, STATUS_LABELS, LEVEL_LABELS, MY_STATUS_LABELS, isWorking,
} from '../format.js';
import './detail.css';

const SHOWN_FEATURES = 6;
const SHOWN_HEADINGS = 10;
const LONG_TITLE = 64; // letters: a name longer than this gets a smaller size, so it stays at two or three lines
const LONG_SUMMARY = 320; // letters: only a summary you wrote yourself gets this long; it opens with a button
const SIDE_GAP = 20; // the side column's bottom stays this far from the window's bottom edge while it sticks
const DISCARD = { title: 'Throw away your changes?', message: 'What you typed in the form will be lost.', confirmLabel: 'Throw away', danger: true };
const STILL_READING = 'You can edit this link once the robot has finished reading it.';

// The same key and request everywhere, so a link loaded ahead is found again when you reach it.
export const detailQuery = (id, q) => ({ queryKey: ['link', id, q], queryFn: () => api(`/links/${id}?${toQuery({ q })}`) });

const exactTime = date => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(date));
const times = n => `${n} ${n === 1 ? 'time' : 'times'}`;
const splitList = (text, by) => text.split(by).map(item => item.trim()).filter(Boolean);
const stillMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// How far an element sits below the top of the window's scrolling area, right now.
const belowTop = (element, scroller) => element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

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
    return MY_STATUS_LABELS[link.myStatus] ? <span className="pill pill-status">{MY_STATUS_LABELS[link.myStatus]}</span> : null;
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
      <div className="detail-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// Puts this link in your compare picks, or takes it out. Once 4 links are picked, a fifth can't be added.
// After adding, a message offers "Compare now" when there are 2 or more.
function CompareToggle({ link, onCompare, className = '' }) {
  const picks = useComparePicks();
  const toast = useToast();
  const inCompare = picks.some(pick => pick.id === link.id);
  const full = !inCompare && picks.length >= MAX_COMPARE;
  return (
    <button
      type="button"
      className={`btn btn-ghost detail-compare${inCompare ? ' is-on' : ''}${full ? ' is-full' : ''} ${className}`}
      aria-pressed={inCompare}
      aria-disabled={full || undefined}
      aria-label={inCompare ? 'In compare' : 'Compare'}
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
      {inCompare ? <Check size={16} aria-hidden="true" /> : <Columns3 size={16} aria-hidden="true" />}
      <span className="detail-compare-label">{inCompare ? 'In compare' : 'Compare'}</span>
    </button>
  );
}

// The main button. It counts as using the link, like opening it from a card does.
function OpenWebsite({ link, owner, className = '' }) {
  const countOpen = useCountOpen();
  return (
    <a
      className={`btn btn-primary detail-open ${className}`}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the website (O)"
      onClick={() => {
        if (owner) countOpen(link.id);
      }}
    >
      <ExternalLink size={16} aria-hidden="true" /> Open website
    </a>
  );
}

function CopyLink({ url }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast('Couldn’t copy. Select the address and copy it instead.', 'error');
    }
  };
  return (
    <button type="button" className={`icon-btn${copied ? ' detail-copied' : ''}`} onClick={copy} aria-label={copied ? 'Copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'}>
      {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
    </button>
  );
}

// The ••• button: the owner's less common actions, tucked away so the bar stays calm. It is one of our own menus,
// so on phones it slides up from the bottom of the screen like the others. Keys: ↑ ↓ move, Enter picks, Esc closes.
// `waiting`: the next link is on its way, so nothing here acts on the one about to leave.
// `editOff` is why Edit can't be used right now. It stays on the menu and says so when picked (phones have no tooltips).
function OwnerMenu({ onEdit, onDelete, waiting, editOff }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const button = useRef(null);
  const pick = action => {
    setOpen(false);
    button.current?.focus();
    action();
  };
  const onKey = event => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')];
    const at = items.indexOf(document.activeElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };
  return (
    <div className="dropdown detail-owner-menu">
      <button
        ref={button}
        type="button"
        className={`icon-btn${open ? ' is-open' : ''}`}
        aria-label="More actions"
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Ellipsis size={20} aria-hidden="true" />
      </button>
      <Popover open={open} onClose={close} anchor={button} label="More actions" role="menu" className="detail-menu" focusFirst="[role='menuitem']">
        <div onKeyDown={onKey}>
          <button
            type="button"
            role="menuitem"
            className="menu-option"
            disabled={waiting}
            aria-disabled={editOff ? true : undefined}
            title={editOff || undefined}
            onClick={() => pick(editOff ? () => toast({ title: editOff, tone: 'info' }) : onEdit)}
          >
            <Pencil size={16} aria-hidden="true" className="menu-icon" />
            <span className="menu-text">Edit</span>
          </button>
          <button type="button" role="menuitem" className="menu-option is-danger" disabled={waiting} onClick={() => pick(onDelete)}>
            <Trash2 size={16} aria-hidden="true" className="menu-icon" />
            <span className="menu-text">Delete</span>
          </button>
        </div>
      </Popover>
    </div>
  );
}

// A list that shows its first few items, with a button that slides the rest open.
function ShortList({ items, shown, className, render, id }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className={className}>{items.slice(0, shown).map(render)}</ul>
      {items.length > shown ? (
        <>
          <Reveal open={all} id={id}>
            <ul className={`${className} is-rest`}>{items.slice(shown).map((item, index) => render(item, index + shown))}</ul>
          </Reveal>
          <SeeMore className="detail-see-more" open={all} controls={id} more={`Show all ${items.length}`} onClick={() => setAll(!all)} />
        </>
      ) : null}
    </>
  );
}

// What shape each picture really is, remembered for the time the page is open: coming back to a link (or reaching one
// that was loaded ahead) draws its frame in the right shape at once.
const pictureShapes = new Map();
const FLATTEST = 2.4; // wider pictures sit in a frame of this shape, with quiet space above and below
const NARROWEST = 1.55; // narrower ones (a square, a poster) sit in a frame of the usual 16:9 shape, with quiet space at the sides
const frameShape = shape => (shape < NARROWEST ? 16 / 9 : Math.min(shape, FLATTEST));
const shapeOf = image => image.naturalWidth / image.naturalHeight;
// Shapes far from the usual ones show whole, with quiet space around them (phones have one frame shape for all).
const shapeClass = shape => (shape < 1.6 ? ' is-odd is-tall' : shape > 2.2 ? ' is-odd' : '');

// The picture in its own shape, never cut and never stretched. The frame takes the picture's shape once it is known,
// and the room saved for it (see .detail-picture) is as tall as the tallest frame, so nothing under it can jump.
// Clicking it opens the website, like the big button does.
function HeroPicture({ link, owner }) {
  const box = useRef(null);
  const countOpen = useCountOpen();
  const [shape, setShape] = useState(() => pictureShapes.get(link.imageUrl) ?? null);
  const measure = image => {
    if (!image?.naturalWidth) return;
    pictureShapes.set(link.imageUrl, shapeOf(image));
    setShape(shapeOf(image));
  };
  // Already there when the window is drawn (in the browser's memory): the right shape before the first paint.
  useLayoutEffect(() => {
    const image = box.current.querySelector('.preview-picture');
    if (image?.complete) measure(image);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <a
      ref={box}
      className={`detail-picture${shape ? shapeClass(shape) : ''}`}
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      aria-hidden="true"
      style={shape ? { '--shape': frameShape(shape), '--picture-shape': shape } : undefined}
      onClick={() => {
        if (owner) countOpen(link.id);
      }}
      onLoad={event => {
        if (event.target.matches('.preview-picture')) measure(event.target);
      }}
    >
      <Preview link={link} big />
    </a>
  );
}

// The short summary. Only one you wrote yourself can be long: it then shows four lines and a button for the rest.
function HeroSummary({ text }) {
  const [all, setAll] = useState(false);
  if (!text) return null;
  const long = text.length > LONG_SUMMARY;
  return (
    <>
      <p className={`detail-summary${long && !all ? ' is-short' : ''}`}>{text}</p>
      {long ? (
        <button type="button" className="detail-link-btn detail-summary-more" onClick={() => setAll(!all)}>
          {all ? 'Show less' : 'Read all'}
        </button>
      ) : null}
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

// Grey rows for "Similar" while they are on their way.
function SimilarSkeleton() {
  return (
    <div className="detail-skeleton-rows" aria-hidden="true">
      <span className="detail-bone is-row" />
      <span className="detail-bone is-row" />
      <span className="detail-bone is-row" />
      <span className="detail-bone is-row" />
    </div>
  );
}

// Grey shapes in the window's layout, only for the very first open when there is nothing to show yet.
function Skeleton() {
  return (
    <>
      <div className="detail-hero" aria-hidden="true">
        <div className="detail-picture">
          <span className="detail-bone is-picture" />
        </div>
        <div className="detail-intro">
          <span className="detail-bone is-pill" />
          <span className="detail-bone is-title" />
          <span className="detail-bone is-line" />
          <span className="detail-bone is-text" />
          <span className="detail-bone is-text is-short" />
          <div className="facts-glance">
            <span className="glance-ghost" />
            <span className="glance-ghost" />
            <span className="glance-ghost" />
            <span className="glance-ghost" />
          </div>
        </div>
      </div>
      <div className="detail-columns" aria-hidden="true">
        <div className="detail-main">
          <span className="detail-bone is-tabs" />
          <span className="detail-bone is-block" />
          <span className="detail-bone is-text" />
          <span className="detail-bone is-text is-short" />
        </div>
        <div className="detail-side">
          <SimilarSkeleton />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </>
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

// What the form sends for each field: spaces around a title or an empty line in a list are no change.
const toSend = form => ({ ...form, title: form.title.trim(), tags: splitList(form.tags, ','), tasks: splitList(form.tasks, '\n') });

// Only the fields you changed since the form opened, so a save never puts back an old copy of the others, and tags you
// didn't touch aren't marked as your own.
function changesIn(form, start) {
  const was = toSend(start);
  return Object.fromEntries(Object.entries(toSend(form)).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(was[key])));
}

// `onDirty` tells the window whether there are unsaved changes, so closing or moving on asks first.
function EditForm({ link, categories, onDone, onDirty }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const titleRef = useRef(null);
  const [start] = useState(() => formFrom(link)); // the form as it opened
  const [form, setForm] = useState(start);
  const [titleError, setTitleError] = useState('');
  const [typingTag, setTypingTag] = useState(false); // letters in the tags box that aren't a chip yet
  const changes = changesIn(form, start);
  const dirty = typingTag || Object.keys(changes).length > 0;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);
  // The cursor is ready in the first box. (Not on touch screens, where it would slide the keyboard over the form.)
  useEffect(() => {
    if (window.matchMedia('(hover: hover)').matches) titleRef.current?.focus({ preventScroll: true });
  }, []);

  const save = useMutation({
    mutationFn: () => api(`/links/${link.id}`, { method: 'PATCH', body: changes }),
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
    if (Object.keys(changes).length) save.mutate();
    else onDone(); // nothing to save
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
        <span className="detail-field-name">Title</span>
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
        {titleError ? (
          <span className="field-error" id="detail-title-error" role="alert">
            {titleError}
          </span>
        ) : null}
      </label>
      <div className="detail-form-row">
        <div className="detail-field">
          <span className="detail-field-name">Category</span>
          <Dropdown title="Category" className="detail-dropdown" value={form.category} options={options} onChange={category => setForm({ ...form, category })} />
        </div>
        <label>
          <span className="detail-field-name">
            Collection <span className="hint">optional</span>
          </span>
          <input className="input" maxLength={80} {...field('collection')} placeholder="Video tools" />
        </label>
      </div>
      {/* Not wrapped in its <label>: a click on a label presses the first button in it, here a chip's ×. */}
      <div className="detail-field">
        <label htmlFor="detail-tags">
          <span className="detail-field-name">
            Tags <span className="hint">Enter or a comma adds a tag</span>
          </span>
        </label>
        <TagInput id="detail-tags" value={form.tags} onChange={tags => setForm({ ...form, tags })} placeholder="video, free, editing" onTyping={setTypingTag} />
      </div>
      <label>
        <span className="detail-field-name">
          Summary <span className="hint">up to 1000 letters</span>
        </span>
        <textarea className="input" rows={3} maxLength={1000} {...field('summary')} />
      </label>
      <label>
        <span className="detail-field-name">
          What you can do with it <span className="hint">one per line, helps search find it</span>
        </span>
        <textarea className="input" rows={4} {...field('tasks')} placeholder={'convert PDF to Excel\nmerge PDFs'} />
      </label>
      <label>
        <span className="detail-field-name">
          Your note <span className="hint">helps search find it</span>
        </span>
        <textarea className="input" rows={2} maxLength={1000} {...field('note')} placeholder="Why you saved this" />
      </label>
      {save.isError ? <p className="form-error">{save.error.message}</p> : null}
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

// Important links, the website's headings and the pages read: folded, because you rarely need them.
function MoreDetails({ link, headings }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="detail-more">
      <SeeMore open={open} more="More details" less="Fewer details" controls={`detail-more-${link.id}`} onClick={() => setOpen(!open)} />
      <Reveal open={open} id={`detail-more-${link.id}`}>
        {link.pageLinks?.length > 0 ? (
          <Section title="Important links">
            <div className="detail-page-links">
              {link.pageLinks.map((item, index) => (
                <a key={`${index}-${item.url}`} href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.label} <ExternalLink size={13} aria-hidden="true" />
                </a>
              ))}
            </div>
          </Section>
        ) : null}
        {headings.length > 0 ? (
          <Section title="What’s on the website">
            <ShortList
              id={`detail-headings-${link.id}`}
              items={headings}
              shown={SHOWN_HEADINGS}
              className="detail-headings"
              render={(heading, index) => <li key={`${index}-${heading}`}>{heading}</li>}
            />
          </Section>
        ) : null}
        {link.pagesRead?.length > 0 ? (
          <Section title="Pages read">
            <div className="detail-pages">
              {link.pagesRead.map((page, index) => (
                <a key={`${index}-${page.url}`} href={page.url} target="_blank" rel="noopener noreferrer">
                  <FileText size={13} aria-hidden="true" /> <span>{page.label || page.title || hostOf(page.url)}</span>
                </a>
              ))}
            </div>
          </Section>
        ) : null}
        {link.searchWords?.length > 0 ? (
          <Section title="Also found by">
            <p className="detail-words">{link.searchWords.join(', ')}</p>
          </Section>
        ) : null}
      </Reveal>
    </div>
  );
}

// `ids` are the results on screen, in order, so the arrows can go to the one before or after.
// `onNearEnd` loads more results when you reach the last ones.
// `instant`: the window swaps in without its fade (coming straight from the compare window).
// `total` is how many results there really are, when the server has said so (only some of them may be loaded yet).
export default function LinkDrawer({ id, q, owner, categories, ids = [], total, onClose, onOpen, onTag, onNearEnd, onCompare, instant = false }) {
  const ref = useRef(null);
  const bodyRef = useRef(null); // the one scrolling area
  const sideRef = useRef(null);
  const topMark = useRef(null); // an empty mark at the very top of the scrolling area
  const nameRef = useRef(null); // the big name
  const pressedBackdrop = useRef(false); // the click that closes must start AND end on the dark background
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const countOpen = useCountOpen();
  const deleteLater = useDeleteLater();
  useHiddenLinks(); // a link deleted a moment ago isn't offered in "Similar"; Undo brings it back
  const [editing, setEditing] = useState(false);
  const dirty = useRef(false); // the edit form has unsaved changes
  const setDirty = useCallback(value => {
    dirty.current = value;
  }, []);
  const shown = useRef(false); // a link was on screen during the last render
  // The facts tab stays the same while you go through the results with the arrows, so you can compare them.
  const [tab, setTab] = useState('overview');
  const factsRef = useRef(null);
  const [scrolled, setScrolled] = useState(false); // the window is scrolled: the top bar gets its hairline
  const [pastName, setPastName] = useState(false); // the big name is out of sight: the top bar shows a small one

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
  const hasLink = Boolean(link);
  const similarLoading = detail.data?.similar === null; // shown from the list; the similar links are on their way
  const similar = (detail.data?.similar ?? []).filter(other => !isHidden(other.id));
  const switching = detail.isPlaceholderData && !similarLoading;
  useEffect(() => {
    shown.current = Boolean(id && link);
  });
  const facts = useLinkFacts(id, owner);
  // Only this link's facts: while the next link loads, the one on screen doesn't get its tiles.
  const factsData = link?.id === id ? facts.data : undefined;
  useEffect(() => {
    if (!id) setTab('overview');
  }, [id]);

  // A fact tile opens its tab. When the tabs are low on the screen (a phone, a short window) they come up too.
  const pickTab = useCallback(to => {
    setTab(to);
    const body = bodyRef.current;
    const box = factsRef.current;
    if (!body || !box) return;
    const below = belowTop(box, body);
    if (below > body.clientHeight / 2) body.scrollTo({ top: body.scrollTop + below, behavior: stillMotion() ? 'auto' : 'smooth' });
  }, []);

  // A new tab starts at its own beginning: with the tabs stuck under the top bar, the window goes back up to them.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const box = factsRef.current;
    if (!body || !box) return;
    const above = belowTop(box, body);
    if (above < 0) body.scrollTop += above;
  }, [tab]);

  useEffect(() => {
    if (position >= 0 && position >= ids.length - 3) onNearEnd?.();
  }, [position, ids.length, onNearEnd]);

  // The window opens and closes before the screen is drawn, so going straight to or from the compare window
  // happens in one frame. The focus goes to the scrolling area, so ↑ ↓ and PageDown scroll the window right away
  // (and no button gets a focus ring for nothing).
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (id && !dialog.open) {
      dialog.showModal();
      bodyRef.current?.focus({ preventScroll: true });
    }
    if (!id && dialog.open) dialog.close();
  }, [id]);
  useEffect(() => {
    setEditing(false);
  }, [id]);

  // Each new link starts at the top of the window.
  useLayoutEffect(() => {
    bodyRef.current?.scrollTo?.(0, 0);
    setScrolled(false);
    setPastName(false);
  }, [id]);

  // A new link on screen can take the focused button away with it (a row in the "Similar" list). The focus then comes
  // back to the scrolling area, so ↑ ↓ keep scrolling the window.
  const linkId = link?.id;
  useEffect(() => {
    const focused = document.activeElement;
    if (linkId && (!focused || focused === document.body)) bodyRef.current?.focus({ preventScroll: true });
  }, [linkId]);

  // The top bar's hairline and its small name, without listening to every scroll: the browser says when the top
  // mark and the big name leave the scrolling area.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !hasLink) return undefined;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.target === topMark.current) setScrolled(!entry.isIntersecting);
          else setPastName(!entry.isIntersecting);
        }
      },
      { root: body },
    );
    if (topMark.current) observer.observe(topMark.current);
    if (nameRef.current) observer.observe(nameRef.current);
    else setPastName(false); // the edit form has no big name
    return () => observer.disconnect();
  }, [hasLink, editing]);

  // The side column stays in view while a long tab scrolls. A side column taller than the window sticks only once
  // its bottom has come into view, so nothing in it can ever be out of reach (see .detail-side).
  useEffect(() => {
    const body = bodyRef.current;
    const side = sideRef.current;
    if (!body || !side) return undefined;
    const place = () => side.style.setProperty('--side-top', `${Math.min(0, body.clientHeight - side.offsetHeight - SIDE_GAP)}px`);
    const observer = new ResizeObserver(place);
    observer.observe(body);
    observer.observe(side);
    return () => observer.disconnect();
  }, [hasLink, editing]);

  // The links on either side are loaded ahead, pictures included, so the arrows feel instant.
  useEffect(() => {
    if (!id) return;
    for (const other of [next, previous]) {
      if (!other) continue;
      const query = detailQuery(other, q);
      queryClient.prefetchQuery(factsQuery(other));
      queryClient.prefetchQuery(query).then(() => {
        const url = queryClient.getQueryData(query.queryKey)?.link.imageUrl;
        if (!url) return;
        const image = Object.assign(new Image(), { referrerPolicy: 'no-referrer', src: url });
        image.onload = () => pictureShapes.set(url, shapeOf(image));
      });
    }
  }, [id, next, previous, q, queryClient]);

  // Anything that leaves the link (another link, a tag, closing) asks first when the edit form has unsaved changes.
  const leave = useCallback(
    async action => {
      if (editing && dirty.current && !(await confirm(DISCARD))) return;
      dirty.current = false;
      setEditing(false);
      action();
    },
    [editing, confirm],
  );
  // Back and Forward leave the link too, so they ask the same question.
  useEffect(
    () =>
      holdBack(goOn => {
        if (!dirty.current) return false;
        leave(goOn);
        return true;
      }),
    [leave],
  );
  const go = useCallback(to => to && leave(() => onOpen(to)), [leave, onOpen]);
  const close = () => leave(onClose);

  // ← → and Esc on the keyboard, and O for the website. Listening on the page (not the window) keeps them working
  // after a click removed the focused button, like a row in the "Similar" list that is gone once the next link shows.
  // Esc is handled here too, so closing always goes through `close` (and its unsaved-changes question) in every browser.
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!id) return;
    const onKey = event => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.target !== document.body && !ref.current.contains(event.target)) return; // another window has the keys
      if (document.querySelectorAll('dialog[open]').length > 1) return; // a question is open on top of this window
      if (event.key === 'Escape') {
        if (event.target.closest?.('[aria-expanded="true"], [role="listbox"], [role="menu"]')) return; // Esc closes that menu first
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (editing || event.target.closest?.('input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]')) return;
      if (event.key === 'o' || event.key === 'O') {
        ref.current.querySelector('.detail-open')?.click();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const to = event.key === 'ArrowLeft' ? previous : next;
      if (to) {
        event.preventDefault();
        go(to);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [id, editing, previous, next, go]);

  // Hidden on 2026-10-28: a periodic background refresh is planned instead.
  // Needs `trackLinks` from ../hooks.js, `RefreshCw` from lucide-react and `useToast()` when it comes back.
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

  // Always the link the question names, the one on screen (`id` may already be the next one, while it loads).
  async function removeLink() {
    const sure = await confirm({
      title: 'Delete this link?',
      message: `“${link.title}” will be removed from your library. You’ll have a few seconds to undo it.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!sure) return;
    deleteLater([link.id], { title: 'Link deleted', description: link.title });
    dirty.current = false;
    onClose();
  }

  // The edit form sits where the name was, at the top of the window, wherever you were when you asked for it.
  const startEditing = () => {
    setEditing(true);
    bodyRef.current?.scrollTo(0, 0);
  };
  const toTop = () => bodyRef.current?.scrollTo({ top: 0, behavior: stillMotion() ? 'auto' : 'smooth' });

  const path = link ? pathOf(link.url) : '';
  const headings = link?.headings?.filter(heading => heading !== link.title) ?? [];
  const hasMore = Boolean(link && (link.pageLinks?.length || headings.length || link.pagesRead?.length || link.searchWords?.length));
  const compareThis = compareIds => leave(() => onCompare(compareIds));
  const showName = pastName && !editing;

  return (
    <dialog
      ref={ref}
      className={`detail${instant ? ' is-instant' : ''}`}
      aria-label={link ? link.title : 'Link details'}
      onClose={() => {
        // A slow page can hear of a close late, when Back has opened the window again by then: that one means nothing.
        if (!ref.current.open) onClose();
      }}
      onCancel={event => {
        // Esc: ask about unsaved changes before the window goes.
        if (editing && dirty.current) {
          event.preventDefault();
          close();
        }
      }}
      onPointerDown={event => {
        pressedBackdrop.current = event.target === ref.current;
      }}
      onClick={event => {
        // A click on the dark background closes it. Selecting text and letting go outside the window does not.
        if (pressedBackdrop.current && event.target === ref.current) close();
      }}
    >
      {/* `id ? … : null`, not `id && …`: an empty id would become an empty text child, and React then clears the
          whole window with textContent, messages placed in it included (see Toasts.jsx). */}
      {id ? (
        <>
          <div className={`detail-window${scrolled ? ' is-scrolled' : ''}`} aria-busy={switching || undefined}>
            {switching ? <div className="detail-progress" aria-hidden="true" /> : null}

            {/* The slim bar: where you are in the results on the left, the main actions on the right. */}
            <header className="detail-top">
              {hasNav ? (
                <nav className="detail-nav" aria-label="Results">
                  <button type="button" className="icon-btn" onClick={() => go(previous)} disabled={!previous} aria-label="Previous result" title="Previous result (←)">
                    <ChevronLeft size={20} aria-hidden="true" />
                  </button>
                  <span className="detail-pos">
                    {position + 1} <span>of</span> {Math.max(total ?? 0, ids.length).toLocaleString('en')}
                  </span>
                  <button type="button" className="icon-btn" onClick={() => go(next)} disabled={!next} aria-label="Next result" title="Next result (→)">
                    <ChevronRight size={20} aria-hidden="true" />
                  </button>
                </nav>
              ) : null}
              {link ? (
                <button
                  type="button"
                  className={`detail-mini${showName ? ' is-shown' : ''}`}
                  tabIndex={showName ? 0 : -1}
                  aria-hidden={!showName}
                  title="Back to the top"
                  onClick={toTop}
                >
                  <SiteIcon link={link} className="row-icon detail-mini-icon" />
                  <span>{link.title}</span>
                </button>
              ) : null}
              <div className="detail-tools">
                {link ? (
                  <>
                    <FavoriteButton link={link} owner={owner} className="icon-btn detail-wide" />
                    <CopyLink key={link.id} url={link.url} />
                    <CompareToggle link={link} onCompare={compareThis} className="detail-wide" />
                    <OpenWebsite link={link} owner={owner} className="detail-wide" />
                    {owner ? <OwnerMenu onEdit={startEditing} onDelete={removeLink} waiting={switching} editOff={isWorking(link) ? STILL_READING : ''} /> : null}
                    <span className="detail-tools-line" aria-hidden="true" />
                  </>
                ) : null}
                <button type="button" className="icon-btn detail-close" onClick={close} aria-label="Close details" title="Close (Esc)">
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
            </header>

            {/* The whole window scrolls as one, so its scrollbar sits at the window's right edge. */}
            <div className="detail-body" ref={bodyRef} tabIndex={-1}>
              <span className="detail-top-mark" ref={topMark} aria-hidden="true" />
              {link ? (
                <>
                  <section className="detail-hero">
                    {/* A new key per link: a picture that failed for one link must not hide the next one's. */}
                    <HeroPicture key={link.id} link={link} owner={owner} />
                    {editing ? (
                      <EditForm key={`edit-${link.id}`} link={link} categories={categories} onDone={() => setEditing(false)} onDirty={setDirty} />
                    ) : (
                      <div className="detail-intro">
                        <div className="detail-pills">
                          <CategoryBadge name={link.category} />
                          {PRICING_LABELS[link.pricing] ? <span className="pill">{PRICING_LABELS[link.pricing]}</span> : null}
                          {LEVEL_LABELS[link.level] ? <span className="pill">{LEVEL_LABELS[link.level]}</span> : null}
                          {isWorking(link) ? (
                            <span className="pill pill-accent">
                              <LoaderCircle size={13} className="spin" aria-hidden="true" /> {STATUS_LABELS[link.status]}
                            </span>
                          ) : null}
                          {link.health === 'broken' ? (
                            <span className="pill pill-gone" title="The page seems to be gone.">
                              <Unlink size={13} aria-hidden="true" /> May be broken
                            </span>
                          ) : null}
                          {!owner ? <MyStatus link={link} owner={owner} /> : null}
                        </div>
                        <h2 ref={nameRef} className={`detail-title${link.title.length > LONG_TITLE ? ' is-long' : ''}`}>
                          {link.title}
                        </h2>
                        <p className="detail-where">
                          <a
                            className="detail-url"
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={link.url}
                            onClick={() => {
                              if (owner) countOpen(link.id);
                            }}
                          >
                            <SiteIcon link={link} className="detail-url-icon" />
                            <span className="detail-host">{hostOf(link.url)}</span>
                            {path ? <span className="detail-path">{path}</span> : null}
                          </a>
                          <span className="detail-when" title={`Added ${exactTime(link.createdAt)}`}>
                            Added <time dateTime={link.createdAt}>{fullDate(link.createdAt)}</time>
                          </span>
                          {link.opens > 0 ? <span className="detail-when">Opened {times(link.opens)}</span> : null}
                        </p>
                        <HeroSummary key={link.id} text={link.summary || link.description} />
                        <Glance link={link} data={factsData} loading={factsBusy(factsData, link.id, owner)} onPick={pickTab} />
                      </div>
                    )}
                  </section>

                  {editing ? null : (
                    <div className="detail-columns">
                      <article className="detail-main">
                        <FactsTabs
                          link={link}
                          owner={owner}
                          data={factsData}
                          tab={tab}
                          onTab={setTab}
                          tabsRef={factsRef}
                          lead={
                            <>
                              {link.status === 'failed' ? (
                                <p className="hint-box warn" title={link.error || undefined}>
                                  <CircleAlert size={16} aria-hidden="true" /> The robot couldn’t read this page. It will try again on its own later.
                                </p>
                              ) : null}
                              {link.snippet ? (
                                <p className="detail-match" title="Where your search words appear">
                                  <Search size={15} aria-hidden="true" />
                                  <span>
                                    <Highlight text={link.snippet} />
                                  </span>
                                </p>
                              ) : null}
                              {link.useFor ? (
                                <p className="detail-use">
                                  <Lightbulb size={16} aria-hidden="true" />
                                  <span>{link.useFor}</span>
                                </p>
                              ) : null}
                              {link.note ? (
                                <Section title="Your note">
                                  <p className="detail-note">{link.note}</p>
                                </Section>
                              ) : null}
                            </>
                          }
                          overview={
                            <>
                              {owner && link.aiStatus === 'basic' && !isWorking(link) ? (
                                <p className="hint-box">This is a basic description from the page. Add a free Groq key to get AI summaries.</p>
                              ) : null}
                              {link.aiStatus === 'pending' && !isWorking(link) ? (
                                <p className="hint-box">The free AI is resting. A better summary will be added automatically later.</p>
                              ) : null}

                              {link.tasks.length > 0 ? (
                                <Section title="What you can do with it">
                                  <ul className="detail-tasks">
                                    {link.tasks.map((task, index) => (
                                      <li key={`${index}-${task}`}>
                                        <ArrowRight size={15} aria-hidden="true" /> <span>{task.charAt(0).toUpperCase() + task.slice(1)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </Section>
                              ) : null}

                              {link.features.length > 0 ? (
                                <Section title="Key features">
                                  <ShortList
                                    key={link.id}
                                    id={`detail-features-${link.id}`}
                                    items={link.features}
                                    shown={SHOWN_FEATURES}
                                    className="detail-features"
                                    render={(feature, index) => (
                                      <li key={`${index}-${feature}`}>
                                        <Check size={16} aria-hidden="true" /> <span>{feature}</span>
                                      </li>
                                    )}
                                  />
                                </Section>
                              ) : null}

                              {link.quickStart?.length > 0 ? (
                                <Section title="Quick start">
                                  <ol className="detail-steps">
                                    {link.quickStart.map((step, index) => (
                                      <li key={`${index}-${step}`}>{step}</li>
                                    ))}
                                  </ol>
                                </Section>
                              ) : null}

                              {link.overview || link.audience ? (
                                <Section title="In more detail">
                                  {link.overview ? <p className="detail-overview">{link.overview}</p> : null}
                                  {link.audience ? (
                                    <p className="detail-audience">
                                      <strong>Who it’s for:</strong> {link.audience}
                                    </p>
                                  ) : null}
                                </Section>
                              ) : null}
                            </>
                          }
                        />
                      </article>

                      <aside className="detail-side" ref={sideRef} aria-label="Related">
                        {owner ? (
                          <div className="detail-status-row">
                            <span>Your status</span>
                            <MyStatus link={link} owner={owner} />
                          </div>
                        ) : null}

                        <Section
                          title="Similar in your library"
                          action={
                            similar.length > 0 ? (
                              <button
                                type="button"
                                className="detail-compare-all"
                                onClick={() => compareThis([link.id, ...similar.slice(0, MAX_COMPARE - 1).map(other => other.id)])}
                                title="See this link and the similar ones side by side"
                              >
                                Compare all
                              </button>
                            ) : null
                          }
                        >
                          {similar.length > 0 ? (
                            <ul className="detail-similar">
                              {similar.map(other => (
                                <li key={other.id} style={hueOf(other.category)}>
                                  <button type="button" className="detail-similar-row" onClick={() => go(other.id)} title={other.title}>
                                    <SiteIcon link={other} />
                                    <span className="detail-similar-text">
                                      <strong>{other.title}</strong>
                                      <span>{other.summary || other.description || hostOf(other.url)}</span>
                                    </span>
                                  </button>
                                  {/* A sibling of the row (not inside it): a button can't hold another button. */}
                                  <button
                                    type="button"
                                    className="detail-similar-compare"
                                    onClick={() => compareThis([link.id, other.id])}
                                    aria-label={`Compare ${link.title} with ${other.title}`}
                                    title={`Compare with ${other.title}`}
                                  >
                                    <Columns3 size={15} aria-hidden="true" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : similarLoading ? (
                            <SimilarSkeleton />
                          ) : (
                            <p className="detail-empty">Nothing similar saved yet.</p>
                          )}
                        </Section>

                        {link.tags.length > 0 ? (
                          <Section title="Tags">
                            <div className="detail-tags">
                              {link.tags.map(tag => (
                                <button key={tag} type="button" className="detail-tag" onClick={() => leave(() => onTag(tag))} title={`All links tagged ${tag}`}>
                                  #{tag}
                                </button>
                              ))}
                            </div>
                          </Section>
                        ) : null}

                        <Section title="Details">
                          <dl className="detail-facts">
                            <dt>Added</dt>
                            <dd>
                              <time dateTime={link.createdAt}>{exactTime(link.createdAt)}</time>
                            </dd>
                            {link.collection ? (
                              <>
                                <dt>Collection</dt>
                                <dd>
                                  <Folder size={14} aria-hidden="true" /> {link.collection}
                                </dd>
                              </>
                            ) : null}
                            {link.siteName ? (
                              <>
                                <dt>Website</dt>
                                <dd>{link.siteName}</dd>
                              </>
                            ) : null}
                            {link.opens > 0 ? (
                              <>
                                <dt>Opened</dt>
                                <dd>
                                  {times(link.opens)}
                                  {link.openedAt ? `, last ${timeAgo(link.openedAt)}` : ''}
                                </dd>
                              </>
                            ) : null}
                            {link.github ? (
                              <>
                                <dt>GitHub</dt>
                                <dd>
                                  <span>
                                    <Star size={14} aria-hidden="true" /> {compactNumber(link.github.stars)} stars
                                    {link.github.language ? ` · ${link.github.language}` : ''}
                                    {link.github.license ? ` · ${link.github.license}` : ''}
                                  </span>
                                  {link.github.pushedAt ? <span className="detail-sub">Updated {timeAgo(link.github.pushedAt)}</span> : null}
                                </dd>
                              </>
                            ) : null}
                          </dl>
                        </Section>

                        {hasMore ? <MoreDetails key={link.id} link={link} headings={headings} /> : null}
                      </aside>
                    </div>
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
            </div>

            {/* Phones: the main actions stay under your thumb. (The same ones sit in the top bar on bigger screens.) */}
            {link && !editing ? (
              <div className="detail-dock">
                <OpenWebsite link={link} owner={owner} />
                <FavoriteButton link={link} owner={owner} className="icon-btn" />
                <CompareToggle link={link} onCompare={compareThis} />
              </div>
            ) : null}
          </div>

          {/* On wide screens the arrows also float outside the window, like a photo viewer.
              The ones in the top bar do the same job for the keyboard and screen readers. */}
          {hasNav ? (
            <>
              <button type="button" className="detail-float detail-float-prev" onClick={() => go(previous)} disabled={!previous} aria-hidden="true" tabIndex={-1}>
                <ChevronLeft size={24} />
              </button>
              <button type="button" className="detail-float detail-float-next" onClick={() => go(next)} disabled={!next} aria-hidden="true" tabIndex={-1}>
                <ChevronRight size={24} />
              </button>
            </>
          ) : null}
        </>
      ) : null}
    </dialog>
  );
}
