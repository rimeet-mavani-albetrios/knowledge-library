// "Add links": paste any number of links (or import a bookmarks file), then watch each one get filled in.
import { useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, CircleCheck, LoaderCircle, Clock, Copy, CircleAlert, ChevronDown, FileUp, X } from 'lucide-react';
import Modal from './Modal.jsx';
import { api, findUrls } from '../api.js';
import { parseBookmarks } from '../bookmarks.js';
import { trackLinks, useTracked, useDebounced } from '../hooks.js';
import { CategoryBadge } from '../categories.jsx';
import { STATUS_LABELS, hostOf, isWorking } from '../format.js';

const MAX_LINKS = 1000;

function StatusIcon({ status }) {
  if (status === 'ready') return <CircleCheck size={18} className="ok" aria-hidden="true" />;
  if (status === 'failed') return <CircleAlert size={18} className="bad" aria-hidden="true" />;
  if (status === 'queued') return <Clock size={18} className="muted" aria-hidden="true" />;
  return <LoaderCircle size={18} className="spin accent" aria-hidden="true" />;
}

function Progress({ result, onMore, onClose }) {
  const added = useTracked(result.added.map(link => link.id));
  const done = added.filter(link => !isWorking(link)).length;
  const shown = added.slice(0, 60);

  return (
    <div className="progress">
      <p className="progress-summary">
        {result.added.length > 0 && <strong>{result.added.length} added</strong>}
        {result.duplicates.length > 0 && <span>{result.duplicates.length} already saved</span>}
        {result.invalid.length > 0 && <span>{result.invalid.length} not valid</span>}
      </p>
      {added.length > 0 && (
        <>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={added.length} aria-valuenow={done} aria-label="Links finished">
            <span style={{ width: `${(done / added.length) * 100}%` }} />
          </div>
          <p className="progress-count">
            {done === added.length ? 'All done. Your links are in the library.' : `${done} of ${added.length} done. You can close this window; the robot keeps working.`}
          </p>
        </>
      )}
      <ul className="progress-list">
        {shown.map(link => (
          <li key={link.id}>
            <StatusIcon status={link.status} />
            <span className="progress-name">
              {link.status === 'ready' ? link.title : hostOf(link.url)}
              {link.status === 'ready' && <CategoryBadge name={link.category} />}
            </span>
            <span className="progress-state">{STATUS_LABELS[link.status]}</span>
          </li>
        ))}
        {result.duplicates.slice(0, 20).map(link => (
          <li key={`d${link.id}`}>
            <Copy size={18} className="warn" aria-hidden="true" />
            <span className="progress-name">{link.title}</span>
            <span className="progress-state warn">Already saved</span>
          </li>
        ))}
        {result.invalid.slice(0, 10).map(text => (
          <li key={`i${text}`}>
            <CircleAlert size={18} className="bad" aria-hidden="true" />
            <span className="progress-name">{text}</span>
            <span className="progress-state bad">Not a link</span>
          </li>
        ))}
      </ul>
      {added.length > shown.length && <p className="hint">…and {added.length - shown.length} more.</p>}
      <div className="form-actions">
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

const SHOWN_FOUND = 100;

// The links found in what you pasted, before they are added. Each one can be taken out,
// and the ones already in your library say so.
function FoundList({ items, saved, onRemove }) {
  return (
    <div className="found-list">
      <p className="found-head">
        <strong>
          {items.length} {items.length === 1 ? 'link' : 'links'} found
        </strong>
        {saved.size > 0 && <span className="warn">{saved.size} already saved</span>}
      </p>
      <ul className="progress-list">
        {items.slice(0, SHOWN_FOUND).map(({ url }) => {
          const { host, rest } = splitUrl(url);
          return (
            <li key={url}>
              <span className="progress-name" title={url}>
                <strong>{host}</strong>
                {rest && <span className="muted">{rest}</span>}
              </span>
              {saved.has(url) && <span className="progress-state warn">Already saved</span>}
              <button type="button" className="icon-btn icon-btn-sm" aria-label={`Don’t add ${host}${rest}`} title="Don’t add" onClick={() => onRemove(url)}>
                <X size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN_FOUND && <p className="hint">…and {items.length - SHOWN_FOUND} more.</p>}
    </div>
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

export default function AddDialog({ open, onClose }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('paste');
  const [text, setText] = useState('');
  const [file, setFile] = useState(null); // { name, text }
  const [extra, setExtra] = useState({ tags: '', collection: '', note: '' });
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState(null);
  const [removed, setRemoved] = useState(() => new Set()); // links you took out of the list
  const fileInput = useRef(null);

  const source = tab === 'paste' ? text : (file?.text ?? '');
  const urls = useMemo(() => findUrls(source), [source]);
  // A bookmarks file: every link brings its folder name as a tag.
  const bookmarks = useMemo(() => (tab === 'file' && file?.text ? parseBookmarks(file.text) : null), [tab, file]);
  const found = useMemo(() => (bookmarks ? bookmarks.items : urls.map(url => ({ url, tags: [] }))), [bookmarks, urls]);
  const chosen = found.filter(item => !removed.has(item.url));
  const count = chosen.length;

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
  const fresh = chosen.filter(item => !saved.has(item.url)).length; // the ones that will really be added

  const add = useMutation({
    mutationFn: () =>
      api('/links', { method: 'POST', body: { ...(bookmarks ? { items: chosen } : { urls: chosen.map(item => item.url) }), ...extra } }),
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
    setResult(null);
    setRemoved(new Set());
    add.reset();
  }

  function close() {
    onClose();
    setTimeout(reset, 200);
  }

  async function readFile(chosen) {
    if (!chosen) return;
    if (chosen.size > 5_000_000) {
      setFile({ name: chosen.name, text: '', error: 'This file is bigger than 5 MB. Split it into smaller files.' });
      return;
    }
    setFile({ name: chosen.name, text: await chosen.text() });
  }

  const tooMany = count > MAX_LINKS;

  return (
    <Modal open={open} onClose={close} title="Add links" labelledBy="add-title" className="add-dialog">
      {result ? (
        <Progress result={result} onMore={reset} onClose={close} />
      ) : (
        <form
          onSubmit={event => {
            event.preventDefault();
            if (fresh && !tooMany) add.mutate();
          }}
        >
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'paste'} onClick={() => setTab('paste')}>
              Paste links
            </button>
            <button type="button" role="tab" aria-selected={tab === 'file'} onClick={() => setTab('file')}>
              Import a file
            </button>
          </div>

          {tab === 'paste' ? (
            <label className="field">
              <span className="sr-only">Links</span>
              <textarea
                className="input links-input"
                rows={7}
                data-autofocus
                value={text}
                onChange={event => setText(event.target.value)}
                placeholder={'Paste one or many links, one per line.\nAny text works too: the links are found automatically.\n\nhttps://www.ilovepdf.com\nhttps://ollama.com'}
              />
            </label>
          ) : (
            <div
              className={`dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={event => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={event => {
                event.preventDefault();
                setDragging(false);
                readFile(event.dataTransfer.files[0]);
              }}
            >
              <FileUp size={30} aria-hidden="true" />
              <p>
                <strong>{file ? file.name : 'Drop a file here'}</strong>
                <span>Bookmarks exported from Chrome, Edge, Firefox or Safari (.html), or a .txt / .csv file</span>
              </p>
              <button type="button" className="btn btn-ghost" onClick={() => fileInput.current.click()}>
                <Upload size={16} aria-hidden="true" /> Choose file
              </button>
              <input ref={fileInput} type="file" accept=".html,.htm,.txt,.csv,.md,.json" hidden onChange={event => readFile(event.target.files[0])} />
              {file?.error && <p className="form-error">{file.error}</p>}
            </div>
          )}
          {bookmarks?.folders.length > 0 && (
            <p className="hint folders-found">
              Found {bookmarks.folders.length} {bookmarks.folders.length === 1 ? 'folder' : 'folders'}. Each link gets its folder’s
              name as a tag: {bookmarks.folders.slice(0, 6).join(', ')}
              {bookmarks.folders.length > 6 && ` and ${bookmarks.folders.length - 6} more`}.
            </p>
          )}
          {chosen.length > 0 && (
            <FoundList items={chosen} saved={saved} onRemove={url => setRemoved(new Set(removed).add(url))} />
          )}

          <details className="extras">
            <summary>
              <ChevronDown size={16} aria-hidden="true" /> Add tags, a collection or a note (optional)
            </summary>
            <div className="extras-grid">
              <label>
                Tags
                <input className="input" value={extra.tags} onChange={event => setExtra({ ...extra, tags: event.target.value })} placeholder="video, free" />
              </label>
              <label>
                Collection
                <input className="input" value={extra.collection} onChange={event => setExtra({ ...extra, collection: event.target.value })} placeholder="Video tools" />
              </label>
              <label className="wide">
                Note
                <input className="input" value={extra.note} onChange={event => setExtra({ ...extra, note: event.target.value })} placeholder="Why you're saving these" />
              </label>
            </div>
          </details>

          {add.isError && <p className="form-error">{add.error.message}</p>}
          {tooMany && <p className="form-error">That’s {count} links. Add up to {MAX_LINKS} at a time.</p>}

          <div className="form-actions">
            <span className="found">{source && !count ? 'No links found yet' : ''}</span>
            <button type="button" className="btn btn-ghost" onClick={close}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!fresh || tooMany || add.isPending}>
              {add.isPending ? 'Adding…' : count && !fresh ? 'All already saved' : fresh > 1 ? `Add ${fresh} links` : 'Add link'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
