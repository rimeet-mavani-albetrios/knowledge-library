// The buttons at the right of the compare window's tools row: "Add link" (opens the "Pick links to compare" window
// on top, to add links or take some out; it keeps to 4 itself), "Copy link" (the address of this comparison, to
// share or keep), and the owner's "Which should I pick?", which asks the free AI (one question per click) and
// hands the answer to the window.
// Props: `ids` (the links compared), `owner`, `loaded` (all links are on screen), `answer` (the AI's answer for
// these links, or null), onAnswer(answer) (the window shows it), onEdit() (open the picker for these links).
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Check, Link2, LoaderCircle, Plus, Sparkles } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from './Toasts.jsx';
import './compare-actions.css';

const COPIED_MS = 1500; // how long the button says "Copied"

// Copies the page's address: it holds ?compare=…, so it opens this same comparison.
function CopyLink() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      // Only on https (and localhost); elsewhere the browser has no clipboard for pages.
      if (!navigator.clipboard) throw new Error('This browser does not let the page copy.');
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      toast({ title: "Couldn't copy the link", description: 'Copy the address from the address bar instead.', tone: 'error' });
    }
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn-ghost compare-tool compare-copy${copied ? ' is-copied' : ''}`}
        onClick={copy}
        aria-label="Copy a link to this comparison"
        title="Copy a link to this comparison"
      >
        {copied ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
        {/* Both words take the same place, so the button keeps its width (the buttons beside it don't move). */}
        <span className="compare-tool-label compare-copy-label">
          <span className={copied ? 'is-off' : undefined}>Copy link</span>
          <span className={copied ? undefined : 'is-off'}>Copied</span>
        </span>
      </button>
      {/* Outside the button: screen readers don't read changes inside one. */}
      <span className="sr-only" role="status">
        {copied ? 'Link copied' : ''}
      </span>
    </>
  );
}

export default function CompareActions({ ids, owner, loaded, answer, onAnswer, onEdit }) {
  const toast = useToast();
  // The links asked about travel with the question: if you add or take out a link while the AI thinks,
  // its answer stays with the links it was about (and the window doesn't show it for the new set).
  const pick = useMutation({
    mutationFn: asked => api('/compare/pick', { method: 'POST', body: { ids: asked } }),
    onSuccess: (result, asked) => onAnswer({ key: asked.join(','), ...result }),
    onError: error => toast({ title: 'No answer from the AI', description: error.message, tone: 'error' }),
  });
  return (
    <div className="compare-actions">
      <button
        type="button"
        className="btn btn-ghost compare-tool"
        onClick={() => onEdit?.()}
        aria-haspopup="dialog"
        title="Add links from your library, or take some out"
      >
        <Plus size={16} aria-hidden="true" />
        <span className="compare-tool-label">Add link</span>
      </button>
      <CopyLink />
      {owner && (
        <button type="button" className="btn btn-ghost compare-ask" onClick={() => pick.mutate(ids)} disabled={pick.isPending || !loaded}>
          {pick.isPending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          {pick.isPending ? 'Thinking…' : answer ? 'Ask again' : 'Which should I pick?'}
        </button>
      )}
    </div>
  );
}
