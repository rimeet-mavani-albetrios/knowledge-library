// The bar at the bottom of the screen while you select links: add a tag to all of them, move them to a collection,
// or delete them. Deleting asks first in our own window (never the browser's confirm()).
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Folder, Hash, LoaderCircle, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import { useConfirm } from './Confirm.jsx';
import './bulk.css';

const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

const DONE = {
  tag: n => `Tag added to ${plural(n, 'link')}`,
  collection: n => `${plural(n, 'link')} moved`,
  refresh: n => `Reading ${plural(n, 'link')} again…`,
  delete: n => `${plural(n, 'link')} deleted`,
};

// `ids` are the selected links; `allIds` the ones on screen, for "Select all".
export default function BulkBar({ ids, allIds, onSelect, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [step, setStep] = useState(null); // null | 'tag' | 'collection'
  const [value, setValue] = useState('');
  const [error, setError] = useState(''); // our own message under the small form

  const change = useMutation({
    mutationFn: ({ action, value: text = '' }) => api('/links/bulk', { method: 'POST', body: { ids, action, value: text } }),
    onSuccess: ({ changed }, { action }) => {
      for (const key of ['links', 'link', 'facets', 'me', 'map']) queryClient.invalidateQueries({ queryKey: [key] });
      toast(DONE[action](changed));
      setStep(null);
      setValue('');
      onSelect(new Set());
    },
    onError: err => toast(err.message, 'error'),
  });

  const count = ids.length;
  const all = count === allIds.length;
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
    change.mutate({ action: step, value: value.trim() });
  }

  async function remove() {
    if (!count) return;
    const yes = await confirm({
      title: `Delete ${plural(count, 'link')}?`,
      message: 'This can’t be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (yes) change.mutate({ action: 'delete' });
  }

  return (
    <div className="bulk-bar" role="region" aria-label="Selected links">
      <p className="bulk-count" aria-live="polite">
        <span className="bulk-number">{count}</span>
        <span className="bulk-word">selected</span>
        <button type="button" className="link-btn bulk-select-all" onClick={() => onSelect(new Set(all ? [] : allIds))}>
          {all ? 'Clear' : `Select all ${allIds.length}`}
        </button>
      </p>

      {step ? (
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
          <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel" onClick={() => ask(null)}>
            <X size={18} />
          </button>
        </form>
      ) : (
        <div className="bulk-actions">
          <button type="button" className="btn btn-ghost" disabled={!count} onClick={() => ask('tag')}>
            <Hash size={16} aria-hidden="true" /> Add tag
          </button>
          <button type="button" className="btn btn-ghost" disabled={!count} onClick={() => ask('collection')}>
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
          <button type="button" className="btn btn-ghost bulk-delete" disabled={!count || change.isPending} onClick={remove}>
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
        </div>
      )}

      <button type="button" className="btn btn-primary bulk-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
