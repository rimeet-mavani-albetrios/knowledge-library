// The bar at the bottom of the screen while you select links: add a tag to all of them, move them to a collection,
// or delete them. Deleting asks first in our own window (never the browser's confirm()), and then offers Undo for a
// few seconds before the links are really deleted (deleteLater.js).
// "Select all" picks every link in the view (its category, filters and order, or all the results of a search), also
// the ones further down that aren't loaded yet: it asks the server for their ids, so the number on the button is the
// real one, the same as "26 links found". Only "the nearest links" of a search that found nothing close has no such
// number: there it picks the links shown.
// A big change can take seconds (a tag on 1,000 links, say), so the bar says what it's doing until the answer comes.
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Folder, Hash, LoaderCircle, Trash2, X } from 'lucide-react';
import { api, toQuery } from '../api.js';
import { isHidden, useDeleteLater } from '../deleteLater.js';
import { useToast } from './Toasts.jsx';
import { useConfirm } from './Confirm.jsx';
import './bulk.css';

const MAX_SELECT = 2000; // the most one "Select all" picks: the server's MAX_BULK (server/links.js)
const BIG_CHANGE = 50; // from this many links a change can take a moment, so the bar says what it's doing
const number = n => n.toLocaleString('en'); // 1,030
const plural = (n, word) => `${number(n)} ${n === 1 ? word : `${word}s`}`;

const DONE = {
  tag: n => `Tag added to ${plural(n, 'link')}`,
  collection: n => `${plural(n, 'link')} moved`,
  refresh: n => `Reading ${plural(n, 'link')} again…`,
};

const WORKING = {
  tag: n => `Adding the tag to ${plural(n, 'link')}…`,
  collection: n => `Moving ${plural(n, 'link')}…`,
};

// `ids` are the selected links (also ones not loaded yet, after "Select all"); `shownIds` the ones on screen.
// `view` is the list you see, { total, filters } (total is undefined while it loads), or null for the nearest links
// of a search that found nothing close, where "Select all" picks the links shown.
export default function BulkBar({ ids, shownIds, view, onSelect, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const deleteLater = useDeleteLater();
  const [step, setStep] = useState(null); // null | 'tag' | 'collection'
  const [value, setValue] = useState('');
  const [error, setError] = useState(''); // our own message under the small form
  // What "Select all" was asked for must still be on screen when the ids arrive: the same filters, and the bar
  // still open (Done pressed meanwhile means nothing should end up selected).
  const viewKey = view ? JSON.stringify(view.filters) : '';
  const [gatheringFor, setGatheringFor] = useState(null); // the view whose links are being asked for
  const gathering = gatheringFor === viewKey; // (another view chosen meanwhile has its own "Select all" ready)
  const latestView = useRef(viewKey);
  latestView.current = viewKey;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const change = useMutation({
    // The links travel with the action, so the answer is about exactly the links that were sent.
    mutationFn: ({ ids: chosen, action, value: text = '' }) => api('/links/bulk', { method: 'POST', body: { ids: chosen, action, value: text } }),
    onSuccess: ({ changed }, { action }) => {
      // Everything that shows these links, an open comparison and its website facts included.
      for (const key of ['links', 'link', 'facets', 'me', 'map', 'compare', 'compare-facts']) queryClient.invalidateQueries({ queryKey: [key] });
      toast(DONE[action](changed));
      setStep(null);
      setValue('');
      onSelect(new Set());
    },
    onError: err => toast(err.message, 'error'),
  });

  const count = ids.length;
  const known = !view || view.total !== undefined; // the view's number is here (not while a new filter loads)
  const wanted = view ? Math.min(view.total ?? 0, MAX_SELECT) : shownIds.length; // how many "Select all" picks
  const all = count > 0 && count >= wanted;
  let selectLabel = `Select all ${number(shownIds.length)} shown`;
  if (view) selectLabel = !known || !view.total ? 'Select all' : view.total > MAX_SELECT ? `Select first ${number(MAX_SELECT)}` : `Select all ${number(view.total)}`;
  // What's on its way to the server (it stays with the action, also when the selection changes meanwhile).
  const sent = change.isPending ? change.variables : null;
  const working = sent && sent.ids.length >= BIG_CHANGE ? WORKING[sent.action](sent.ids.length) : '';

  async function selectAll() {
    if (all) {
      onSelect(new Set());
      return;
    }
    // The nearest links of a search, or a view whose links are all on screen already: nothing more to ask for.
    if (!view || shownIds.length >= view.total) {
      onSelect(new Set(shownIds));
      return;
    }
    const asked = viewKey;
    setGatheringFor(asked);
    try {
      const { ids: every, capped, max } = await api(`/links/ids?${toQuery(view.filters)}`);
      if (!mounted.current || latestView.current !== asked) return; // that selection is gone meanwhile
      onSelect(new Set(every.filter(id => !isHidden(id)))); // not the ones you just deleted
      if (capped) {
        toast({
          title: `Selected the first ${number(max)} links`,
          description: 'That’s the most at once. Change these, then select the rest.',
          tone: 'info',
        });
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (mounted.current) setGatheringFor(current => (current === asked ? null : current));
    }
  }

  const ask = next => {
    setStep(next);
    setValue('');
    setError('');
  };

  function submit(event) {
    event.preventDefault();
    if (!count || change.isPending) return;
    if (step === 'tag' && !value.trim()) {
      setError('Type the tag to add.');
      return;
    }
    change.mutate({ ids, action: step, value: value.trim() });
  }

  async function remove() {
    if (!count) return;
    const yes = await confirm({
      title: `Delete ${plural(count, 'link')}?`,
      message: 'You’ll have a few seconds to undo it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!yes) return;
    deleteLater(ids, { title: `${plural(count, 'link')} deleted`, wholeView: view && count >= view.total ? view.filters : null });
    setStep(null);
    setValue('');
    onSelect(new Set());
  }

  return (
    <div className={`bulk-bar${working ? ' is-working' : ''}`} role="region" aria-label="Selected links">
      <p className="bulk-count" aria-live="polite">
        <span className="bulk-number">{number(count)}</span>
        <span className="bulk-word">selected</span>
        <button type="button" className="link-btn bulk-select-all" onClick={selectAll} disabled={gathering || Boolean(sent) || !known || (!all && !wanted)}>
          {gathering ? (
            <>
              <LoaderCircle size={14} className="spin" aria-hidden="true" /> Selecting…
            </>
          ) : all ? (
            'Clear'
          ) : (
            selectLabel
          )}
        </button>
      </p>

      {working ? (
        <p className="bulk-working" role="status">
          <LoaderCircle size={16} className="spin" aria-hidden="true" /> {working}
          <span className="bulk-working-note">This can take a few seconds.</span>
        </p>
      ) : step ? (
        <form className="bulk-form" noValidate onSubmit={submit}>
          <div className="bulk-field">
            <label className="sr-only" htmlFor="bulk-value">
              {step === 'tag' ? 'Tag to add' : 'Collection name'}
            </label>
            <input
              id="bulk-value"
              className="input"
              autoFocus
              autoComplete="off"
              maxLength={step === 'tag' ? 40 : 80}
              value={value}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? 'bulk-error' : undefined}
              onChange={event => {
                setValue(event.target.value);
                if (error) setError('');
              }}
              placeholder={step === 'tag' ? 'Tag, like “Video tools”' : 'Collection (empty = none)'}
            />
            {error && (
              <span className="field-error" id="bulk-error" role="alert">
                <CircleAlert size={14} aria-hidden="true" /> {error}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={!count || change.isPending}>
            {change.isPending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
            {step === 'tag' ? 'Add tag' : 'Move'}
          </button>
          <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel" disabled={change.isPending} onClick={() => ask(null)}>
            <X size={18} />
          </button>
        </form>
      ) : (
        <div className="bulk-actions">
          <button type="button" className="btn btn-ghost" disabled={!count || gathering || change.isPending} onClick={() => ask('tag')}>
            <Hash size={16} aria-hidden="true" /> Add tag
          </button>
          <button type="button" className="btn btn-ghost" disabled={!count || gathering || change.isPending} onClick={() => ask('collection')}>
            <Folder size={16} aria-hidden="true" /> Collection
          </button>
          {/* Hidden on 2026-10-28: a periodic background refresh is planned instead.
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!count || change.isPending}
            onClick={() => change.mutate({ action: 'refresh' })}
            title="The robot reads these pages again and rewrites their summaries"
          >
            <RefreshCw size={16} aria-hidden="true" /> Read again
          </button>
          */}
          <button type="button" className="btn btn-ghost bulk-delete" disabled={!count || change.isPending || gathering} onClick={remove}>
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
        </div>
      )}

      <button type="button" className="btn btn-primary bulk-done" disabled={change.isPending} onClick={onDone}>
        Done
      </button>
    </div>
  );
}
