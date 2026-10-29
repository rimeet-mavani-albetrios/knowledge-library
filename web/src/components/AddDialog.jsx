// "Add links": paste any number of links, or drop a bookmarks file on the same box, then watch each one get filled in.
// One screen: the paste box (with the file strip under it), what was found, the optional details, the Add button.
// Pressing Add with nothing valid shows our own message under the box — never the browser's.
import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, CircleCheck, LoaderCircle, Clock, Copy, CircleAlert, ChevronDown, FileUp, FileText, X, Bot, RotateCcw,
} from 'lucide-react';
import Modal from './Modal.jsx';
import { api, findUrls } from '../api.js';
import { parseBookmarks } from '../bookmarks.js';
import { trackLinks, useTracked, useDebounced } from '../hooks.js';
import { CategoryBadge } from '../categories.jsx';
import { STATUS_LABELS, hostOf, isWorking } from '../format.js';
import './add.css';

const MAX_LINKS = 1000;
const MAX_FILE_BYTES = 5_000_000;
const SHOWN_FOUND = 100;
const MAX_TAG_LENGTH = 40;

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
  const parts = [
    result.added.length > 0 && `${result.added.length} added`,
    result.duplicates.length > 0 && `${result.duplicates.length} already saved`,
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
              ? 'Nothing new was added. These links were already in your library.'
              : finished
                ? 'All done. Your links are in the library.'
                : 'The robot is reading each page and writing its summary, category and tags.'}
          </p>
        </div>
      </header>

      {added.length > 0 && (
        <div className="progress-track">
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={added.length} aria-valuenow={done} aria-label="Links finished">
            <span style={{ width: `${(done / added.length) * 100}%` }} />
          </div>
          <span className="progress-count">
            {done} of {added.length} done
          </span>
        </div>
      )}

      <ul className="progress-list add-list">
        {shown.map(link => (
          <li key={link.id}>
            <StatusIcon status={link.status} />
            <span className="progress-name">
              {link.status === 'ready' ? link.title : hostOf(link.url)}
              {link.status === 'ready' && <CategoryBadge name={link.category} />}
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
        {result.invalid.slice(0, 10).map((text, i) => (
          <li key={`i${i}`}>
            <CircleAlert size={18} className="bad" aria-hidden="true" />
            <span className="progress-name">{text}</span>
            <span className="progress-state bad">Not a link</span>
          </li>
        ))}
      </ul>
      {added.length > shown.length && <p className="hint">…and {added.length - shown.length} more.</p>}

      <div className="form-actions add-actions">
        {added.length > 0 && !finished && <span className="add-foot">You can close this window; the robot keeps working.</span>}
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

// Each one can be taken out, and the ones already in your library say so.
function FoundList({ items, saved, onRemove }) {
  return (
    <ul className="progress-list add-list found-rows" aria-label="Links found">
      {items.slice(0, SHOWN_FOUND).map(({ url }) => {
        const { host, rest } = splitUrl(url);
        const isSaved = saved.has(url);
        return (
          <li key={url} className={isSaved ? 'is-saved' : undefined}>
            <HostMark url={url} />
            <span className="progress-name found-name" title={url}>
              <strong>{host}</strong>
              {rest && <span className="muted">{rest}</span>}
            </span>
            {isSaved && <span className="pill found-saved">Already saved</span>}
            <button type="button" className="icon-btn icon-btn-sm found-remove" aria-label={`Don’t add ${host}${rest}`} title="Don’t add" onClick={() => onRemove(url)}>
              <X size={16} />
            </button>
          </li>
        );
      })}
      {items.length > SHOWN_FOUND && <li className="found-more hint">…and {items.length - SHOWN_FOUND} more.</li>}
    </ul>
  );
}

// ---------- Tags as chips ----------

// Type a tag, then Enter or a comma makes it a chip. × takes one out; Backspace on an empty box takes out the last one.
// The value given back is the comma list the server expects ("video, free").
function TagInput({ id, value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const input = useRef(null);
  const tags = useMemo(() => value.split(',').map(tag => tag.trim()).filter(Boolean), [value]);

  function add(text) {
    const next = [...tags];
    for (const part of text.split(',')) {
      const tag = part.trim().slice(0, MAX_TAG_LENGTH);
      if (tag && !next.some(known => known.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    if (next.length !== tags.length) onChange(next.join(', '));
    setDraft('');
  }

  const remove = index => onChange(tags.filter((_, i) => i !== index).join(', '));

  return (
    <div className={`tag-input${tags.length ? ' has-tags' : ''}`} onClick={() => input.current?.focus()}>
      {tags.map((tag, index) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button type="button" className="tag-chip-remove" aria-label={`Remove tag ${tag}`} onClick={() => remove(index)}>
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        ref={input}
        id={id}
        className="tag-input-field"
        value={draft}
        maxLength={MAX_TAG_LENGTH + 1}
        placeholder={tags.length ? '' : placeholder}
        autoComplete="off"
        onChange={event => (event.target.value.includes(',') ? add(event.target.value) : setDraft(event.target.value))}
        onBlur={() => draft.trim() && add(draft)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            // Enter adds a chip here; it must not press the Add button.
            event.preventDefault();
            add(draft);
          } else if (event.key === 'Backspace' && !draft && tags.length) {
            event.preventDefault();
            remove(tags.length - 1);
          }
        }}
      />
    </div>
  );
}

// Lines you pasted that hold no link (file contents don't count: a bookmarks file is HTML).
function nonLinkLines(text) {
  if (!text.trim() || /<a\s[^>]*href=/i.test(text)) return [];
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/https?:\/\//i.test(line));
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
  const [error, setError] = useState(''); // our own message under the paste box
  const [shaking, setShaking] = useState(false); // the box shakes once when Add has nothing to add
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
  const chosen = found.filter(item => !removed.has(item.url));
  const count = chosen.length;
  const hasSource = Boolean(text.trim() || file?.text);

  // Asks the library which links it already has, once you stop typing for a moment.
  const toCheck = useDebounced(found.length <= MAX_LINKS ? found.map(item => item.url).join('\n') : '', 400);
  const check = useQuery({
    queryKey: ['saved-check', toCheck],
    queryFn: () => api('/links/check', { method: 'POST', body: { urls: toCheck.split('\n') } }),
    enabled: open && Boolean(toCheck),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const saved = useMemo(() => new Set(check.data?.saved ?? []), [check.data]);
  const savedCount = chosen.filter(item => saved.has(item.url)).length;
  const fresh = count - savedCount; // the ones that will really be added
  const tooMany = count > MAX_LINKS;
  const hasTags = chosen.some(item => item.tags.length);

  const add = useMutation({
    mutationFn: () =>
      api('/links', {
        method: 'POST',
        body: { ...(hasTags ? { items: chosen } : { urls: chosen.map(item => item.url) }), ...extra },
      }),
    onSuccess: data => {
      trackLinks(data.added);
      setResult(data);
      queryClient.invalidateQueries({ queryKey: ['links'] });
      queryClient.invalidateQueries({ queryKey: ['facets'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function reset() {
    setText('');
    setFile(null);
    setExtra(EMPTY_EXTRA);
    setResult(null);
    setRemoved(new Set());
    setError('');
    setDragging(false);
    if (fileInput.current) fileInput.current.value = '';
    add.reset();
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
  }

  // Our own required-field check, instead of the browser's.
  function submit(event) {
    event.preventDefault();
    if (add.isPending) return;
    let problem = '';
    if (!count) problem = 'Paste at least one link. It should start with http:// or https://.';
    else if (tooMany) problem = `That’s ${count} links. Add up to ${MAX_LINKS} at a time.`;
    else if (!fresh && !check.isFetching) problem = 'All of these are already in your library.';
    if (problem) {
      setError(problem);
      setShaking(true);
      textarea.current?.focus();
      return;
    }
    add.mutate();
  }

  const shownError = error || (tooMany ? `That’s ${count} links. Add up to ${MAX_LINKS} at a time.` : '');
  const fileLinks = fromFile.filter(item => !removed.has(item.url)).length;
  const addLabel = add.isPending ? 'Adding…' : (fresh || count) > 1 ? `Add ${fresh || count} links` : 'Add link';

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
              {hasSource && (
                <p className="add-detect" aria-live="polite">
                  <strong>{count ? plural(count, 'link') : 'No links'} found</strong>
                  {savedCount > 0 && <span>{savedCount} already saved</span>}
                  {notLinks.length > 0 && <span>{plural(notLinks.length, 'line')} {notLinks.length === 1 ? 'is' : 'are'} not links</span>}
                </p>
              )}
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
                    {!file.error && (
                      <span className="file-chip-meta">
                        · {plural(fileLinks, 'link')}
                        {bookmarks?.folders.length > 0 && ` · ${plural(bookmarks.folders.length, 'folder')}`}
                      </span>
                    )}
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

            {file?.error && <p className="field-error">{file.error}</p>}
            {shownError && (
              <p className="field-error" id="add-error" role="alert">
                <CircleAlert size={15} aria-hidden="true" /> {shownError}
              </p>
            )}
            {bookmarks?.folders.length > 0 && (
              <p className="hint folders-found">
                Found {plural(bookmarks.folders.length, 'folder')}. Each link gets its folder’s name as a tag: {bookmarks.folders.slice(0, 6).join(', ')}
                {bookmarks.folders.length > 6 && ` and ${bookmarks.folders.length - 6} more`}.
              </p>
            )}

            {count > 0 && <FoundList items={chosen} saved={saved} onRemove={url => setRemoved(new Set(removed).add(url))} />}

            {notLinks.length > 0 && (
              <details className="not-links">
                <summary>
                  <ChevronDown size={14} aria-hidden="true" /> Not links ({notLinks.length})
                </summary>
                <ul>
                  {notLinks.slice(0, 20).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                  {notLinks.length > 20 && <li>…and {notLinks.length - 20} more.</li>}
                </ul>
              </details>
            )}
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

          {add.isError && (
            <div className="add-error-box" role="alert">
              <CircleAlert size={18} aria-hidden="true" />
              <span>{add.error.message}</span>
              <button type="button" className="btn btn-ghost" onClick={() => add.mutate()} disabled={add.isPending}>
                <RotateCcw size={15} aria-hidden="true" /> Try again
              </button>
            </div>
          )}

          <div className="form-actions add-actions">
            <span className="add-foot">
              <Bot size={15} aria-hidden="true" /> The robot reads each page and writes the summary, category and tags for you.
            </span>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary add-submit" disabled={add.isPending} aria-busy={add.isPending || undefined}>
              {add.isPending && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
              {addLabel}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
