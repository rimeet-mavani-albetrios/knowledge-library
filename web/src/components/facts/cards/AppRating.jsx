// The website's phone apps: the iPhone app's rating from the App Store, and a Google Play link.
// Only apps the website itself links to are shown.
import { Smartphone, Star, ExternalLink } from 'lucide-react';
import { compactNumber } from '../../../format.js';

export const tab = 'popularity';
export const order = 20;

export function glance(facts) {
  const ios = facts.app?.ios;
  if (!ios?.rating) return null;
  return { icon: Smartphone, text: `${ios.rating.toFixed(1)} on iPhone`, tab: 'popularity', tone: ios.rating >= 4.5 ? 'good' : ios.rating < 3.5 ? 'warn' : undefined };
}

function Stars({ rating }) {
  return (
    <span className="app-stars" aria-hidden="true">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={15} className={rating >= n - 0.25 ? 'is-full' : rating >= n - 0.75 ? 'is-half' : ''} />
      ))}
    </span>
  );
}

export default function AppRating({ facts }) {
  const app = facts.app;
  if (!app?.ios && !app?.android) return null;
  const { ios, android } = app;
  return (
    <section className="fact-card">
      <h3 className="fact-card-title">
        <Smartphone size={14} aria-hidden="true" /> Phone apps
      </h3>
      {ios ? (
        <div className="app-row">
          <div className="app-main">
            <strong className="app-name">{ios.name || 'iPhone app'}</strong>
            {ios.rating ? (
              <span className="app-rating">
                <span className="app-number">{ios.rating.toFixed(1)}</span>
                <Stars rating={ios.rating} />
                <span className="fact-muted">
                  {compactNumber(ios.ratings)} {ios.ratings === 1 ? 'rating' : 'ratings'} on the App Store
                </span>
              </span>
            ) : (
              <span className="fact-muted">Not enough ratings yet</span>
            )}
          </div>
          <a className="btn btn-ghost fact-btn" href={ios.url} target="_blank" rel="noopener noreferrer">
            App Store <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      ) : null}
      {android ? (
        <div className="app-row">
          <div className="app-main">
            <strong className="app-name">Android app</strong>
            <span className="fact-muted">Google Play doesn’t share ratings with other apps.</span>
          </div>
          <a className="btn btn-ghost fact-btn" href={android.url} target="_blank" rel="noopener noreferrer">
            Google Play <ExternalLink size={14} aria-hidden="true" />
          </a>
        </div>
      ) : null}
    </section>
  );
}
