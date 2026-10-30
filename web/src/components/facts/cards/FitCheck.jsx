// "Is it right for you?": you type what you need, the free AI answers with a score out of 10, a verdict, the
// reasons and one thing to watch out for. Only for the owner (each check uses some of the AI's daily limit).
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Sparkles, Check, TriangleAlert, LoaderCircle } from 'lucide-react';
import { api } from '../../../api.js';

export const tab = 'overview';
export const order = 0;

let lastNeed = ''; // kept while you move between links, so you can check the same need on several

const toneOf = score => (score >= 7 ? 'good' : score >= 4 ? 'warn' : 'bad');

export default function FitCheck({ link, owner }) {
  const inputRef = useRef(null);
  const [need, setNeed] = useState(lastNeed);
  const [missing, setMissing] = useState(false);
  const check = useMutation({
    mutationFn: text => api(`/links/${link.id}/fit`, { method: 'POST', body: { need: text } }),
  });
  if (!owner) return null;

  const submit = event => {
    event.preventDefault();
    const text = need.trim();
    if (text.length < 3) {
      setMissing(true);
      inputRef.current?.focus();
      return;
    }
    check.mutate(text);
  };
  const result = check.data;

  return (
    <section className="fact-card fit-check" aria-label="Fit check">
      <form className="fit-form" onSubmit={submit} noValidate>
        <label htmlFor={`fit-${link.id}`} className="fit-label">
          <Sparkles size={15} aria-hidden="true" /> Is it right for you?
        </label>
        <div className="fit-row">
          <input
            ref={inputRef}
            id={`fit-${link.id}`}
            className="input"
            value={need}
            maxLength={300}
            placeholder="What do you need it for? For example: make invoices for my shop"
            aria-invalid={missing ? 'true' : undefined}
            aria-describedby={missing ? `fit-${link.id}-error` : undefined}
            onChange={event => {
              setNeed(event.target.value);
              lastNeed = event.target.value;
              if (missing && event.target.value.trim()) setMissing(false);
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={check.isPending}>
            {check.isPending ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}
            {check.isPending ? 'Checking…' : 'Check fit'}
          </button>
        </div>
        {missing ? (
          <p className="field-error" id={`fit-${link.id}-error`} role="alert">
            Type what you need it for first.
          </p>
        ) : null}
        {check.isError ? (
          <p className="field-error" role="alert">
            {check.error.message}
          </p>
        ) : null}
      </form>

      {result && !check.isPending ? (
        <div className={`fit-result is-${toneOf(result.score)}`} aria-live="polite">
          <div className="fit-score" aria-label={`Fit score ${result.score} out of 10`}>
            <strong>{result.score}</strong>
            <span>/10</span>
          </div>
          <div className="fit-text">
            <p className="fit-verdict">{result.verdict}</p>
            {result.reasons.length > 0 ? (
              <ul className="fit-reasons">
                {result.reasons.map((reason, index) => (
                  <li key={`${index}-${reason}`}>
                    <Check size={15} aria-hidden="true" /> {reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {result.watchOut ? (
              <p className="fit-watch">
                <TriangleAlert size={15} aria-hidden="true" />
                <span>
                  <strong>Watch out:</strong> {result.watchOut}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
