// The bar at the bottom of the screen while you select links: add a tag to all of them, move them to a collection,
// have the robot read them again, or delete them. Deleting asks first.
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Folder, Hash, RefreshCw, Trash2, X } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';

const DONE = {
  tag: n => `Tag added to ${n} ${n === 1 ? 'link' : 'links'}`,
  collection: n => `${n} ${n === 1 ? 'link' : 'links'} moved`,
  refresh: n => `Reading ${n} ${n === 1 ? 'link' : 'links'} again…`,
  delete: n => `${n} ${n === 1 ? 'link' : 'links'} deleted`,
};

// `ids` are the selected links; `allIds` the ones on screen, for "Select all".
export default function BulkBar({ ids, allIds, onSelect, onDone }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState(null); // null | 'tag' | 'collection' | 'delete'
  const [value, setValue] = useState('');

  const change = useMutation({
    mutationFn: ({ action, value: text = '' }) => api('/links/bulk', { method: 'POST', body: { ids, action, value: text } }),
    onSuccess: ({ changed }, { action }) => {
      for (const key of ['links', 'link', 'facets', 'me', 'map']) queryClient.invalidateQueries({ queryKey: [key] });
      toast(DONE[action](changed));
      setStep(null);
      setValue('');
      onSelect(new Set());
    },
    onError: error => toast(error.message, 'error'),
  });

  const count = ids.length;
  const all = count === allIds.length;
  const ask = next => {
    setStep(next);
    setValue('');
  };

  return (
    <div className="bulk-bar" role="region" aria-label="Selected links">
      <p className="bulk-count" aria-live="polite">
        <strong>{count}</strong> selected
        <button type="button" className="link-btn" onClick={() => onSelect(new Set(all ? [] : allIds))}>
          {all ? 'Clear' : `Select all ${allIds.length}`}
        </button>
      </p>

      {step === 'tag' || step === 'collection' ? (
        <form
          className="bulk-form"
          onSubmit={event => {
            event.preventDefault();
            if (step === 'collection' || value.trim()) change.mutate({ action: step, value });
          }}
        >
          <label className="sr-only" htmlFor="bulk-value">
            {step === 'tag' ? 'Tag to add' : 'Collection name'}
          </label>
          <input
            id="bulk-value"
            className="input"
            autoFocus
            maxLength={step === 'tag' ? 40 : 80}
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder={step === 'tag' ? 'Tag, like “Video tools”' : 'Collection (empty = none)'}
          />
          <button type="submit" className="btn btn-primary" disabled={!count || change.isPending || (step === 'tag' && !value.trim())}>
            {step === 'tag' ? 'Add tag' : 'Move'}
          </button>
          <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setStep(null)}>
            <X size={18} />
          </button>
        </form>
      ) : step === 'delete' ? (
        <div className="bulk-form bulk-confirm" role="alert">
          <span>
            Delete {count} {count === 1 ? 'link' : 'links'}? This can’t be undone.
          </span>
          <button type="button" className="btn btn-ghost" onClick={() => setStep(null)}>
            Keep
          </button>
          <button type="button" className="btn btn-danger" disabled={change.isPending} onClick={() => change.mutate({ action: 'delete' })}>
            Delete
          </button>
        </div>
      ) : (
        <div className="bulk-actions">
          <button type="button" className="btn btn-ghost" disabled={!count} onClick={() => ask('tag')}>
            <Hash size={16} aria-hidden="true" /> Add tag
          </button>
          <button type="button" className="btn btn-ghost" disabled={!count} onClick={() => ask('collection')}>
            <Folder size={16} aria-hidden="true" /> Collection
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!count || change.isPending}
            onClick={() => change.mutate({ action: 'refresh' })}
            title="The robot reads these pages again and rewrites their summaries"
          >
            <RefreshCw size={16} aria-hidden="true" /> Read again
          </button>
          <button type="button" className="btn btn-ghost bulk-delete" disabled={!count} onClick={() => ask('delete')}>
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
