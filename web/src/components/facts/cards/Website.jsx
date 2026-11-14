// The website's address: its secure lock (HTTPS) and since when it exists. Its tile shows the year the company was
// founded (Wikidata), or else the year the address was first online.
import { CalendarDays, Lock, LockOpen, Globe } from 'lucide-react';
import { fullDate } from '../../../format.js';

export const tab = 'trust';
export const order = 30;

const YEAR = 365.25 * 24 * 3600_000;

// "14 years ago", rounded down like the trust grade's "Online for 14 years".
function howLongAgo(date) {
  const ms = Date.now() - new Date(date);
  const years = Math.floor(ms / YEAR);
  if (years >= 1) return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  const months = Math.max(1, Math.floor(ms / (YEAR / 12)));
  return `${months} ${months === 1 ? 'month' : 'months'} ago`;
}

export function glance(facts) {
  if (facts.wikidata?.founded) return { icon: CalendarDays, label: 'Founded', value: String(facts.wikidata.founded), rank: 50, spare: true, tab: 'company' };
  const created = facts.age?.created ? new Date(facts.age.created) : null;
  return created ? { icon: CalendarDays, label: 'Online since', value: String(created.getFullYear()), rank: 50, spare: true, tab: 'trust' } : null;
}

export default function Website({ facts }) {
  const { tls, age } = facts;
  if (!tls && !age?.created) return null;
  return (
    <section className="fact-card">
      <h3 className="fact-card-title">
        <Globe size={14} aria-hidden="true" /> The website’s address
      </h3>
      <ul className="fact-lines">
        {tls ? (
          <li className={tls.ok ? 'is-ok' : 'is-not'}>
            {tls.ok ? <Lock size={15} aria-hidden="true" /> : <LockOpen size={15} aria-hidden="true" />}
            <span>
              {tls.ok ? 'Secure connection (the lock in your browser)' : 'No working secure connection'}
              {tls.validTo ? (
                <span className="fact-muted"> · certificate valid until {fullDate(tls.validTo)}</span>
              ) : null}
            </span>
          </li>
        ) : null}
        {age?.created ? (
          <li>
            <CalendarDays size={15} aria-hidden="true" />
            <span>
              {age.source === 'archive'
                ? `First seen by the Internet Archive on ${fullDate(age.created)}`
                : `Address registered on ${fullDate(age.created)}`}
              <span className="fact-muted"> · {howLongAgo(age.created)}</span>
            </span>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
