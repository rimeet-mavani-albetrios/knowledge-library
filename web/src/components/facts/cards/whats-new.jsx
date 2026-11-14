// "What's new" on the History tab: the features a website added since you saved it, newest first.
// The robot compares the website's page with last month's copy (server/facts/kinds/features.js); its first visit
// is the starting point, so the list starts empty.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { fullDate, hostOf } from '../../../format.js';
import { SeeMore, Reveal } from '../../SeeMore.jsx';
import './watch.css';

const newestFirst = rows => [...(rows ?? [])].sort((a, b) => new Date(b.at) - new Date(a.at));

export const tab = 'history';
export const order = 30;

export default function WhatsNew({ link, facts, history }) {
  const [showWatched, setShowWatched] = useState(false);
  const watched = facts?.features?.list ?? [];
  const added = newestFirst(history?.feature);
  if (!watched.length && !added.length) return null;
  const saved = fullDate(link.createdAt);

  return (
    <section className="fact-card watch">
      <h3 className="fact-card-title">
        <Sparkles size={14} aria-hidden="true" /> What’s new
      </h3>
      {added.length ? (
        <>
          <p className="watch-since">Since you saved it on {saved}:</p>
          <ul className="watch-new">
            {added.map((feature, index) => (
              <li key={`${index}-${feature.name}`}>
                <Sparkles size={15} aria-hidden="true" />
                <span className="watch-new-name">{feature.name}</span>
                <time dateTime={feature.at}>{fullDate(feature.at)}</time>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="watch-quiet">
          Nothing new since you saved it on {saved}. {facts?.features?.url ? hostOf(facts.features.url) : 'The website'} is checked once a month.
        </p>
      )}
      {watched.length ? (
        <>
          <SeeMore
            className="watch-more"
            open={showWatched}
            more={`The ${watched.length} features being watched`}
            less="Hide the list"
            controls={`watched-${link.id}`}
            onClick={() => setShowWatched(!showWatched)}
          />
          <Reveal open={showWatched} id={`watched-${link.id}`}>
            <ul className="watch-list">
              {watched.map(name => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </Reveal>
        </>
      ) : null}
    </section>
  );
}
