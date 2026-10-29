// The quick verdict at the top of the compare window: one small card per link, in the columns' order, with what
// it wins (cheapest, easiest, the one you use most, most stars, and the AI's pick) and what it's best for, so you
// can decide in a few seconds before reading the table.
// Props: `links` (all loaded), `wins` (per link, the marks its column won in the table: [{ key, label, Icon }],
// so the cards and the table always agree), `aiPickId` (the AI's pick, or null), `phone`,
// onSelect(index) (show that link: its column on a computer, its details on a phone).
import { Trophy } from 'lucide-react';
import { hueOf } from '../categories.jsx';
import { SiteIcon } from './LinkCard.jsx';
import './compare-verdict.css';

// "Use it to turn invoices into data." → "Turn invoices into data", to read after "Best for".
function bestFor(useFor) {
  const text = (useFor ?? '')
    .trim()
    .replace(/^use (it|this)( (to|for|when))?\s+/i, '')
    .replace(/\.$/, '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

export default function CompareVerdict({ links, wins, aiPickId, phone, onSelect }) {
  return (
    <section className="verdict" aria-labelledby="compare-verdict-title">
      <h3 id="compare-verdict-title" className="verdict-title">
        Quick verdict
      </h3>
      {links.map((link, i) => {
        const aiPick = link.id === aiPickId;
        const best = bestFor(link.useFor);
        return (
          <button
            key={link.id}
            type="button"
            className={`verdict-card${aiPick ? ' is-ai-pick' : ''}`}
            style={hueOf(link.category)}
            onClick={() => onSelect(i)}
            title={phone ? 'Open the details' : 'Show its column'}
          >
            <span className="verdict-top">
              <SiteIcon link={link} className="verdict-icon" />
              <span className="verdict-name">{link.title}</span>
            </span>
            <span className="verdict-chips">
              {aiPick ? (
                <span className="verdict-chip is-ai">
                  <Trophy size={13} aria-hidden="true" /> AI pick
                </span>
              ) : null}
              {wins[i].map(win => (
                <span key={win.key} className="verdict-chip">
                  <win.Icon size={13} aria-hidden="true" /> {win.label}
                </span>
              ))}
              {!aiPick && !wins[i].length ? <span className="verdict-none">No standout</span> : null}
            </span>
            {best ? (
              <span className="verdict-best" title={`Best for: ${best}`}>
                <span className="verdict-best-label">Best for:</span> {best}
              </span>
            ) : null}
          </button>
        );
      })}
    </section>
  );
}
