// "Add links": paste any number of links, or drop a bookmarks file on the same box, then watch each one get filled in.
// One screen: the paste box (with the file strip under it), what was found, the optional details, the Add button.
// Pressing Add with nothing valid shows our own message under the box — never the browser's.
// A link from a website you already have (or the same page under another address) gets a calm note on its row and
// is skipped unless you choose "Add anyway" (server/duplicates.js decides what counts as the same).
import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, CircleCheck, LoaderCircle, Clock, Copy, CircleAlert, ChevronDown, FileUp, FileText, X, Bot, RotateCcw, Globe, Info,
} from 'lucide-react';
import Modal from './Modal.jsx';
import TagInput from './TagInput.jsx';
import { api, findUrls } from '../api.js';
import { parseBookmarks } from '../bookmarks.js';
import { trackLinks, useTracked, useDebounced } from '../hooks.js';
import { CategoryBadge } from '../categories.jsx';
import { STATUS_LABELS, hostOf, isWorking } from '../format.js';
import './add.css';

const MAX_LINKS = 1000;
const MAX_FILE_BYTES = 5_000_000;
const SHOWN_FOUND = 100;

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

function StatusIcon({ status }) {
  if (status === 'ready') return <CircleCheck size={18} className="ok" aria-hidden="true" />;
  if (status === 'failed') return <CircleAlert size={18} className="bad" aria-hidden="true" />;
  if (status === 'queued') return <Clock size={18} className="muted" aria-hidden="true" />;
  return <LoaderCircle size={18} className="spin accent" aria-hidden="true" />;
}

// The host's first letter in a soft square: a neutral icon that needs no request to the website.
function HostMark({ url }) {
  const host = hostOf(url);
  const letter = /[a-z0-9]/i.exec(host)?.[0] ?? '?';
  return (
    <span className="host-mark" aria-hidden="true">
      {letter.toUpperCase()}
    </span>
  );
}

function splitUrl(url) {
  try {
    const { hostname, pathname, search } = new URL(url);
    const rest = `${pathname}${search}`;
    return { host: hostname.replace(/^www\./, ''), rest: rest === '/' ? '' : rest };
  } catch {
    return { host: url, rest: '' };
  }
}

// ---------- After adding: the robot works through the list ----------

function Progress({ result, onMore, onClose }) {
  const added = useTracked(result.added.map(link => link.id));
  const done = added.filter(link => !isWorking(link)).length;
  const finished = added.length > 0 && done === added.length;
  const shown = added.slice(0, 60);
  const title = useRef(null);

  // The Add button just disappeared under the keyboard focus; the summary takes it, so it is read out.
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);
  const skipped = result.skipped ?? []; // links from websites you already have, left out on purpose
  const parts = [
    result.added.length > 0 && `${result.added.length} added`,
    result.duplicates.length > 0 && `${result.duplicates.length} already saved`,
    skipped.length > 0 && `${skipped.length} skipped`,
    result.invalid.length > 0 && `${result.invalid.length} not valid`,
  ].filter(Boolean);

  return (
    <div className="progress add-progress">
      <header className={`progress-head${finished ? ' is-done' : ''}`}>
        <span className="progress-mark" aria-hidden="true">
          {added.length === 0 || finished ? <CircleCheck size={22} /> : <LoaderCircle size={22} className="spin" />}
        </span>
        <div>
          <h3 className="progress-title" ref={title} tabIndex={-1}>
            {parts.join(' · ') || 'Nothing new to add'}
          </h3>
          <p className="progress-sub">
            {added.length === 0
              ? result.invalid.length === 0
                ? 'Nothing new was added. These links were already in your library.'
                : result.duplicates.length === 0
                  ? 'Nothing was added. These aren’t web addresses that can be opened.'
                  : 'Nothing new was added.'
              : finished
                ? 'All done. Your links are in the library.'
                : 'The robot is reading each page and writing its summary, category and tags.'}
          </p>
        </div>
      </header>

      {added.length > 0 ? (
        <div className="progress-track">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={added.length} aria-valuenow={done} aria-label="Links finished">
            <span style={{ width: `${(done / added.length) * 100}%` }} />
          </div>
          <span className="progress-count">
            {done} of {added.length} done
          </span>
        </div>
      ) : null}

      <ul className="progress-list add-list">
        {shown.map(link => (
          <li key={link.id}>
            <StatusIcon status={link.status} />
            <span className="progress-name">
              {link.status === 'ready' ? link.title : hostOf(link.url)}
              {link.status === 'ready' ? <CategoryBadge name={link.category} /> : null}
            </span>
            <span className={`progress-state${link.status === 'failed' ? ' bad' : ''}`}>{STATUS_LABELS[link.status]}</span>
          </li>
        ))}
        {result.duplicates.slice(0, 20).map(link => (
          <li key={`d${link.id}`}>
            <Copy size={18} className="warn" aria-hidden="true" />
            <span className="progress-name">{link.title}</span>
            <span className="progress-state warn">Already saved</span>
          </li>
        ))}
        {skipped.slice(0, 20).map(url => (
          <li key={`s${url}`}>
            <Globe size={18} className="muted" aria-hidden="true" />
            <span className="progress-name">{hostOf(url)}</span>
            <span className="progress-state">Skipped</span>
          </li>
        ))}
        {result.invalid.slice(0, 10).map((text, i) => (
          <li key={`i${i}`}>
            <CircleAlert size={18} className="bad" aria-hidden="true" />
            <span className="progress-name">{text}</span>
            <span className="progress-state bad">Not a link</span>
          </li>
        ))}
      </ul>
      {added.length > shown.length ? <p className="hint">…and {added.length - shown.length} more.</p> : null}

      <div className="form-actions add-actions">
        {added.length > 0 && !finished ? <span className="add-foot">You can close this window; the robot keeps working.</span> : null}
        <button type="button" className="btn btn-ghost" onClick={onMore}>
          Add more
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

// ---------- Before adding: the links found in what you pasted ----------

// What the library says about each link in the list (POST /links/check, server/duplicates.js), in list order:
//   saved: this very address is in your library, so it isn't added again (as before)
//   twice: the same address, spelled another way, is higher up in this list (it's added once)
//   page:  the same page is saved under another address (ad codes, youtu.be, a GitHub project's folder)…
//   site:  …or you have other pages of this website ("You have wati.io already: Wati")
// `page` and `site` also come from a link higher up in the same paste ("Same website as wati.io above").
// Those two are only a warning: skipped unless you choose "Add anyway".
function linkStates(items, urls) {
  const states = new Map();
  if (!urls) return states;
  const first = { key: new Map(), page: new Map(), site: new Map() }; // the first link in the list with each one
  for (const { url } of items) {
    const info = urls[url];
    if (!info) continue; // not checked yet: it counts as new until the answer comes
    let state = null;
    if (info.saved) state = { kind: 'saved' };
    else if (first.key.has(info.key)) state = { kind: 'twice' };
    else if (info.match) state = { kind: info.match.kind, match: info.match, site: info.site };
    else if (first.page.has(info.page)) state = { kind: 'page', of: first.page.get(info.page) };
    else if (info.site && first.site.has(info.site)) state = { kind: 'site', of: first.site.get(info.site) };
    if (state) states.set(url, state);
    if (!first.key.has(info.key)) first.key.set(info.key, url);
    if (!first.page.has(info.page)) first.page.set(info.page, url);
    if (info.site && !first.site.has(info.site)) first.site.set(info.site, url);
  }
  return states;
}

const isWarning = state => state?.kind === 'page' || state?.kind === 'site';

// The note under a link the library may have already: what is saved, by name.
function Note({ state }) {
  const Icon = state.kind === 'page' ? Copy : Globe;
  let text;
  let names = '';
  if (state.match) {
    const [first] = state.match.links;
    const more = state.match.total - 1;
    const what = state.kind === 'page' ? ['copy', 'copies'] : ['page', 'pages'];
    const rest = more > 0 ? ` (+${more} more ${more === 1 ? what[0] : what[1]})` : '';
    names = state.match.links.map(link => `${link.title} (${hostOf(link.url)})`).join(', ');
    text =
      state.kind === 'page' ? (
        <>
          Same page already saved: <strong>{first.title}</strong>
          {rest}
        </>
      ) : (
        <>
          You have <strong>{state.site}</strong> already: {first.title}
          {rest}
        </>
      );
  } else {
    const { host, rest } = splitUrl(state.of);
    text = (
      <>
        {state.kind === 'page' ? 'Same page' : 'Same website'} as <strong>{`${host}${rest}`}</strong> above
      </>
    );
  }
  return (
    <span className="found-note" title={names || undefined}>
      <Icon size={13} aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}

// "Skip" or "Add anyway" for a link the library may have already. Skip is the default.
function SkipChoice({ name, adding, onChange }) {
  return (
    <span className="segmented segmented-text found-choice" role="group" aria-label={`${name}: skip it or add it anyway`}>
      <button type="button" aria-pressed={!adding} onClick={() => onChange(false)}>
        Skip
      </button>
      <button type="button" aria-pressed={adding} onClick={() => onChange(true)}>
        Add anyway
      </button>
    </span>
  );
}

// Each one can be taken out, the ones already in your library say so, and the ones from a website you already
// have can be skipped or added anyway.
function FoundList({ items, states, adding, onChoose, onRemove }) {
  return (
    <ul className="progress-list add-list found-rows" aria-label="Links found">
      {items.slice(0, SHOWN_FOUND).map(({ url }) => {
        const { host, rest } = splitUrl(url);
        const state = states.get(url);
        const warn = isWarning(state);
        const skipped = warn && !adding.has(url);
        const done = state?.kind === 'saved' || state?.kind === 'twice';
        const classes = [done ? 'is-saved' : '', warn ? 'has-note' : '', skipped ? 'is-skipped' : ''].filter(Boolean).join(' ');
        return (
          <li key={url} className={classes || undefined}>
            <HostMark url={url} />
            <span className="found-main">
              <span className="progress-name found-name" title={url}>
                <strong>{host}</strong>
                {rest ? <span className="muted">{rest}</span> : null}
              </span>
              {warn ? <Note state={state} /> : null}
            </span>
            {done ? <span className="pill found-saved">{state.kind === 'saved' ? 'Already saved' : 'Twice in this list'}</span> : null}
            {/* On phones the choice goes on a line of its own, under the name. */}
            {warn ? <span className="found-break" aria-hidden="true" /> : null}
            {warn ? <SkipChoice name={`${host}${rest}`} adding={!skipped} onChange={add => onChoose(url, add)} /> : null}
            <button type="button" className="icon-btn icon-btn-sm found-remove" aria-label={`Don’t add ${host}${rest}`} title="Don’t add" onClick={() => onRemove(url)}>
              <X size={16} />
            </button>
          </li>
        );
      })}
      {items.length > SHOWN_FOUND ? <li className="found-more hint">…and {items.length - SHOWN_FOUND} more.</li> : null}
    </ul>
  );
}

// Lines you pasted that hold no link (file contents don't count: a bookmarks file is HTML).
function nonLinkLines(text) {
  if (!text.trim() || /<a\s[^>]*href=/i.test(text)) return [];
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !findUrls(line).length);
}

const EMPTY_EXTRA = { tags: '', collection: '', note: '' };

export default function AddDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null); // { name, text, error? }
  const [extra, setExtra] = useState(EMPTY_EXTRA);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);
  const [removed, setRemoved] = useState(() => new Set()); // links you took out of the list
  const [adding, setAdding] = useState(() => new Set()); // links from a website you already have, to add anyway
  const [error, setError] = useState(''); // our own message under the paste box
  const [shaking, setShaking] = useState(false); // the box shakes once when Add has nothing to add
  const [waiting, setWaiting] = useState(null); // Add was pressed before the check came back: the warnings seen then
  const [notice, setNotice] = useState(false); // new warnings came up after Add was pressed: look first
  const fileInput = useRef(null);
  const textarea = useRef(null);
  const resetTimer = useRef(null);

  // A bookmarks file: every link brings its folder name as a tag. Any other file is read like pasted text.
  const bookmarks = useMemo(() => (file?.text ? parseBookmarks(file.text) : null), [file]);
  const fromFile = useMemo(() => (bookmarks ? bookmarks.items : findUrls(file?.text ?? '').map(url => ({ url, tags: [] }))), [bookmarks, file]);
  const fromText = useMemo(() => findUrls(text).map(url => ({ url, tags: [] })), [text]);
  // Pasted links and file links together, each address once (the file's copy keeps its folder tag).
  const found = useMemo(() => {
    const byUrl = new Map();
    for (const item of [...fromFile, ...fromText]) if (!byUrl.has(item.url)) byUrl.set(item.url, item);
    return [...byUrl.values()];
  }, [fromFile, fromText]);
  const notLinks = useMemo(() => nonLinkLines(text), [text]);
  const chosen = useMemo(() => found.filter(item => !removed.has(item.url)), [found, removed]);
  const count = chosen.length;
  const hasSource = Boolean(text.trim() || file?.text);

  // Asks the library which links it already has (and which websites), once you stop typing for a moment.
  const listKey = found.length <= MAX_LINKS ? found.map(item => item.url).join('\n') : '';
  const toCheck = useDebounced(listKey, 400);
  const check = useQuery({
    queryKey: ['saved-check', toCheck],
    queryFn: () => api('/links/check', { method: 'POST', body: { urls: toCheck.split('\n') } }),
    enabled: open && Boolean(toCheck),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  // The answer for this very list isn't there yet (you just pasted, or it's on its way).
  const checking = open && Boolean(listKey) && (toCheck !== listKey || check.isFetching);
  const states = useMemo(() => linkStates(chosen, check.data?.urls), [chosen, check.data]);
  const tally = { saved: 0, twice: 0, page: 0, site: 0 };
  for (const state of states.values()) tally[state.kind]++;
  const savedCount = tally.saved + tally.twice;
  const warnings = chosen.filter(item => isWarning(states.get(item.url)));
  const skippedItems = warnings.filter(item => !adding.has(item.url));
  const allAdding = warnings.length > 0 && !skippedItems.length;
  // What goes to the library: everything but the skipped ones. Addresses it has already are sent too, so the
  // summary after adding can say "already saved"; the library never saves them twice.
  const skippedSet = new Set(skippedItems);
  const toAdd = chosen.filter(item => !skippedSet.has(item));
  const fresh = count - savedCount - skippedItems.length; // the ones that will really be added
  const newCount = count - savedCount - warnings.length; // the ones with nothing to say about them
  const tooMany = count > MAX_LINKS;

  const add = useMutation({
    mutationFn: ({ items }) => {
      const hasTags = items.some(item => item.tags.length);
      return api('/links', {
        method: 'POST',
        body: { ...(hasTags ? { items } : { urls: items.map(item => item.url) }), ...extra },
      });
    },
    onSuccess: (data, { skipped }) => {
      trackLinks(data.added);
      setResult({ ...data, skipped });
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      queryClient.invalidateQueries({ queryKey: ['saved-check'] });
      queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    },
  });
  const send = () => add.mutate({ items: toAdd, skipped: skippedItems.map(item => item.url) });

  function reset() {
    setText('');
    setFile(null);
    setExtra(EMPTY_EXTRA);
    setResult(null);
    setRemoved(new Set());
    setAdding(new Set());
    setError('');
    setNotice(false);
    setWaiting(null);
    setDragging(false);
    if (fileInput.current) fileInput.current.value = '';
    add.reset();
  }

  // "Skip" or "Add anyway" on one row; `urls` for all of them at once.
  function choose(urls, yes) {
    const next = new Set(adding);
    for (const url of urls) {
      if (yes) next.add(url);
      else next.delete(url);
    }
    setAdding(next);
    setNotice(false);
  }

  // The window fades out first, so the form doesn't flash empty while it closes.
  function close() {
    onClose();
    resetTimer.current = setTimeout(reset, 200);
  }

  // Opened again within those 200 ms: keep what is there instead of wiping it under the cursor.
  useEffect(() => {
    if (open) clearTimeout(resetTimer.current);
    return () => clearTimeout(resetTimer.current);
  }, [open]);

  async function readFile(picked) {
    if (!picked) return;
    setError('');
    if (picked.size > MAX_FILE_BYTES) {
      setFile({ name: picked.name, text: '', error: 'This file is bigger than 5 MB. Split it into smaller files.' });
      return;
    }
    try {
      setFile({ name: picked.name, text: await picked.text() });
    } catch {
      setFile({ name: picked.name, text: '', error: 'This file couldn’t be read. Try saving it again as .html or .txt.' });
    }
  }

  function removeFile() {
    setFile(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  function changeText(value) {
    setText(value);
    if (error) setError('');
    setNotice(false);
  }

  // Our own required-field check, instead of the browser's.
  function submit(event) {
    event?.preventDefault();
    if (add.isPending) return;
    let problem = '';
    if (!count) problem = 'Paste at least one link. It should start with http:// or https://.';
    else if (tooMany) problem = `That’s ${count} links. Add up to ${MAX_LINKS} at a time.`;
    else if (checking) {
      // The library hasn't said yet which websites it has: wait for that, then carry on (see below).
      setWaiting(new Set(warnings.map(item => item.url)));
      return;
    } else if (!fresh) {
      if (count === 1) problem = skippedItems.length ? 'This link is skipped. Choose “Add anyway” to add it.' : 'This link is already in your library.';
      else if (skippedItems.length) problem = 'All of these are skipped. Choose “Add anyway” on the ones you want.';
      else problem = 'All of these are already in your library.';
    }
    if (problem) {
      setError(problem);
      setShaking(true);
      textarea.current?.focus();
      return;
    }
    send();
  }

  // The answer came after Add was pressed. Links from a website you already have that weren't on screen then are
  // left for you to look at first (press Add again); otherwise adding goes on by itself. If the check failed,
  // adding goes on too: it never stops you.
  useEffect(() => {
    if (!waiting || checking) return;
    setWaiting(null);
    if (warnings.some(item => !waiting.has(item.url))) setNotice(true);
    else submit();
    // Runs when the wait ends; `submit` and `warnings` are this render's, so they are up to date then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, checking]);

  const shownError = error || (tooMany ? `That’s ${count} links. Add up to ${MAX_LINKS} at a time.` : '');
  const fileLinks = fromFile.filter(item => !removed.has(item.url)).length;
  const addLabel = add.isPending
    ? 'Adding…'
    : waiting
      ? 'Checking…'
      : (fresh || count) > 1
        ? `Add ${fresh || count} links`
        : 'Add link';

  return (
    <Modal open={open} onClose={close} title="Add links" labelledBy="add-title" className="add-dialog">
      {result ? (
        <Progress result={result} onMore={reset} onClose={close} />
      ) : (
        <form className="add-form" noValidate onSubmit={submit}>
          <section className="add-section">
            <div className="add-section-head">
              <h3 className="add-section-title" id="add-links-label">
                Links
              </h3>
              {hasSource ? (
                <p className="add-detect" aria-live="polite">
                  <strong>{count ? plural(count, 'link') : 'No links'} found</strong>
                  {/* "3 new · 1 same website · 2 already saved", once there is more to say than "found". */}
                  {states.size > 0 ? <span>{newCount} new</span> : null}
                  {tally.page > 0 ? <span>{tally.page} same page</span> : null}
                  {tally.site > 0 ? <span>{tally.site} same website</span> : null}
                  {tally.saved > 0 ? <span>{tally.saved} already saved</span> : null}
                  {tally.twice > 0 ? <span>{tally.twice} twice in this list</span> : null}
                  {notLinks.length > 0 ? <span>{notLinks.length === 1 ? '1 line is not a link' : `${notLinks.length} lines are not links`}</span> : null}
                </p>
              ) : null}
            </div>

            {/* The whole box takes a dropped file, not only the strip under it. */}
            <div
              className={`paste-box${dragging ? ' is-dragging' : ''}${shownError ? ' is-invalid' : ''}${shaking ? ' is-shaking' : ''}`}
              onAnimationEnd={() => setShaking(false)}
              onDragOver={event => {
                event.preventDefault();
                if (!dragging) setDragging(true);
              }}
              onDragLeave={event => {
                // Moving over a child fires a leave too; only a real exit ends the drag look.
                if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
              }}
              onDrop={event => {
                event.preventDefault();
                setDragging(false);
                if (event.dataTransfer.files?.[0]) readFile(event.dataTransfer.files[0]);
              }}
            >
              <textarea
                ref={textarea}
                className="input links-input"
                rows={6}
                data-autofocus
                aria-labelledby="add-links-label"
                aria-invalid={shownError ? 'true' : undefined}
                aria-describedby={shownError ? 'add-error' : undefined}
                value={text}
                onChange={event => changeText(event.target.value)}
                placeholder={'Paste one or many links, one per line.\nAny text works too: the links are found automatically.\n\nhttps://www.ilovepdf.com\nhttps://ollama.com'}
              />

              <div className="file-strip">
                {file ? (
                  <span className={`file-chip${file.error ? ' is-bad' : ''}`}>
                    <FileText size={15} aria-hidden="true" />
                    <span className="file-chip-name">{file.name}</span>
                    {!file.error ? (
                      <span className="file-chip-meta">
                        · {plural(fileLinks, 'link')}
                        {bookmarks?.folders.length > 0 ? ` · ${plural(bookmarks.folders.length, 'folder')}` : null}
                      </span>
                    ) : null}
                    <button type="button" className="file-chip-remove" aria-label={`Remove file ${file.name}`} title="Remove file" onClick={removeFile}>
                      <X size={14} aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <span className="file-strip-text">
                    <FileUp size={15} aria-hidden="true" />
                    or drop a bookmarks file here <span className="file-strip-types">(Chrome, Edge, Firefox, Safari .html, or .txt/.csv)</span>
                  </span>
                )}
                <button type="button" className="link-btn file-strip-pick" onClick={() => fileInput.current?.click()}>
                  <Upload size={14} aria-hidden="true" /> {file ? 'Choose another' : 'Choose file'}
                </button>
                <input ref={fileInput} type="file" accept=".html,.htm,.txt,.csv,.md,.json" hidden onChange={event => readFile(event.target.files[0])} />
              </div>

              <div className="paste-drop" aria-hidden="true">
                <FileUp size={26} />
                <span>Drop the file to read it</span>
              </div>
            </div>

            {file?.error ? <p className="field-error">{file.error}</p> : null}
            {shownError ? (
              <p className="field-error" id="add-error" role="alert">
                <CircleAlert size={15} aria-hidden="true" /> {shownError}
              </p>
            ) : null}
            {bookmarks?.folders.length > 0 ? (
              <p className="hint folders-found">
                Found {plural(bookmarks.folders.length, 'folder')}. Each link gets its folder’s name as a tag: {bookmarks.folders.slice(0, 6).join(', ')}
                {bookmarks.folders.length > 6 ? ` and ${bookmarks.folders.length - 6} more` : null}.
              </p>
            ) : null}

            {count > 0 ? (
              <FoundList
                items={chosen}
                states={states}
                adding={adding}
                onChoose={(url, yes) => choose([url], yes)}
                onRemove={url => {
                  setRemoved(new Set(removed).add(url));
                  setNotice(false);
                }}
              />
            ) : null}
            {/* Many from websites you already have (a bookmarks file, say): one click for all of them. */}
            {warnings.length > 1 ? (
              <p className="found-bulk">
                <span>
                  {allAdding
                    ? `${plural(warnings.length, 'link')} with a note will be added anyway.`
                    : `${plural(skippedItems.length, 'link')} with a note ${skippedItems.length === 1 ? 'is' : 'are'} skipped.`}
                </span>
                <button type="button" className="link-btn" onClick={() => choose(warnings.map(item => item.url), !allAdding)}>
                  {allAdding ? 'Skip them all' : 'Add them all anyway'}
                </button>
              </p>
            ) : null}
            {notice ? (
              <p className="add-notice" role="status">
                <Info size={15} aria-hidden="true" />
                <span>Some links may be saved already. Look at their notes, then press Add again.</span>
              </p>
            ) : null}

            {notLinks.length > 0 ? (
              <details className="not-links">
                <summary>
                  <ChevronDown size={14} aria-hidden="true" /> Not links ({notLinks.length})
                </summary>
                <ul>
                  {notLinks.slice(0, 20).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                  {notLinks.length > 20 ? <li>…and {notLinks.length - 20} more.</li> : null}
                </ul>
              </details>
            ) : null}
          </section>

          <section className="add-section add-details">
            <div className="add-section-head">
              <h3 className="add-section-title">
                Details for these links <span className="add-optional">(optional)</span>
              </h3>
            </div>
            <div className="details-grid">
              <div className="details-field">
                <label htmlFor="add-tags">Tags</label>
                <TagInput id="add-tags" value={extra.tags} onChange={tags => setExtra({ ...extra, tags })} placeholder="video, free" />
                <span className="hint">Enter or a comma adds a tag.</span>
              </div>
              <div className="details-field">
                <label htmlFor="add-collection">Collection</label>
                <input
                  id="add-collection"
                  className="input"
                  maxLength={80}
                  value={extra.collection}
                  onChange={event => setExtra({ ...extra, collection: event.target.value })}
                  placeholder="Video tools"
                  autoComplete="off"
                />
              </div>
              <div className="details-field wide">
                <label htmlFor="add-note">Note</label>
                <textarea
                  id="add-note"
                  className="input"
                  rows={2}
                  maxLength={1000}
                  value={extra.note}
                  onChange={event => setExtra({ ...extra, note: event.target.value })}
                  placeholder="Why you’re saving these"
                />
              </div>
            </div>
          </section>

          {add.isError ? (
            <div className="add-error-box" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{add.error.message}</span>
              <button type="button" className="btn btn-ghost" onClick={send} disabled={add.isPending}>
                <RotateCcw size={15} aria-hidden="true" /> Try again
              </button>
            </div>
          ) : null}

          <div className="form-actions add-actions">
            <span className="add-foot">
              <Bot size={15} aria-hidden="true" /> The robot reads each page and writes the summary, category and tags for you.
            </span>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary add-submit" disabled={add.isPending} aria-busy={add.isPending || waiting ? true : undefined}>
              {add.isPending || waiting ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
              {addLabel}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
