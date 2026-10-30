// The trust grade, A to F, with the reasons behind it (made on the server from facts we can check: see
// server/facts/trust.js).
import { ShieldCheck, ShieldAlert, Check, X } from 'lucide-react';

export const tab = 'trust';
export const order = 10;

export const toneOfGrade = grade => (grade === 'A' || grade === 'B' ? 'good' : grade === 'C' ? 'warn' : 'bad');

export function glance(facts) {
  const grade = facts.trust?.grade;
  if (!grade) return null;
  return { icon: toneOfGrade(grade) === 'good' ? ShieldCheck : ShieldAlert, label: 'Trust', value: grade, rank: 30, tab: 'trust', tone: toneOfGrade(grade) };
}

const SAYS = {
  A: 'Looks trustworthy',
  B: 'Mostly trustworthy',
  C: 'Some things to check',
  D: 'Be careful',
  F: 'Be very careful',
};

export default function Trust({ facts }) {
  const trust = facts.trust;
  if (!trust?.grade) return null;
  return (
    <section className={`fact-card trust is-${toneOfGrade(trust.grade)}`}>
      <div className="trust-head">
        <span className="trust-grade" aria-label={`Trust grade ${trust.grade}`}>
          {trust.grade}
        </span>
        <div>
          <h3 className="trust-title">{SAYS[trust.grade] ?? 'Trust grade'}</h3>
          <p className="fact-muted">Made only from facts we can check. It isn’t a promise.</p>
        </div>
      </div>
      <ul className="trust-reasons">
        {trust.reasons.map((reason, index) => (
          <li key={`${index}-${reason.text}`} className={reason.ok ? 'is-ok' : 'is-not'}>
            {reason.ok ? <Check size={15} aria-label="Good" /> : <X size={15} aria-label="Watch" />}
            <span>{reason.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
