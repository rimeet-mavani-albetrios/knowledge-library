// Ad and tracking scripts found in the home page's code.
import { Radar } from 'lucide-react';

export const tab = 'trust';
export const order = 20;

export function glance(facts) {
  const count = facts.trackers?.count;
  return count >= 8 ? { icon: Radar, text: `${count} trackers`, tab: 'trust', tone: 'warn' } : null;
}

export default function Trackers({ facts }) {
  const trackers = facts.trackers;
  if (!trackers) return null;
  const { count, names = [], gentle = [] } = trackers;
  return (
    <section className="fact-card">
      <h3 className="fact-card-title">
        <Radar size={14} aria-hidden="true" /> Trackers on the home page
      </h3>
      <p className="trackers-count">
        {count === 0 ? (
          'No ad or tracking scripts found.'
        ) : (
          <>
            <strong>{count}</strong> {count === 1 ? 'tracker' : 'trackers'} found
          </>
        )}
      </p>
      {names.length ? (
        <ul className="fact-chips">
          {names.map(name => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      ) : null}
      {gentle.length ? (
        <p className="fact-muted">Also uses visitor counters that don’t follow you: {gentle.join(', ')}.</p>
      ) : null}
      <p className="fact-source">Found in the page’s code. Some trackers load later, so there can be more.</p>
    </section>
  );
}
