// "Rediscover": two short lists side by side (one above the other in a narrow card).
// - Forgotten gems: a few links you saved but never opened. "Show others" goes through a new handful (the server
//   picks 24 for the day, the same all day long, so the list doesn't change under you).
// - Most opened: the 5 links you open the most.
// Clicking a link opens its details on top of the page.
import { useState } from 'react';
import { Shuffle } from 'lucide-react';
import { timeAgo } from '../../format.js';
import { MoreLink } from '../SeeMore.jsx';
import { Card, CategoryTag, LinkRow, plural } from './shared.jsx';
import './rediscover.css';

const GEMS_SHOWN = 4;

export function Rediscover({ gems, mostOpened, plate, onOpenLink }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(gems.items.length / GEMS_SHOWN);
  const shown = gems.items.slice(page * GEMS_SHOWN, page * GEMS_SHOWN + GEMS_SHOWN);

  return (
    <Card
      id="stats-rediscover"
      plate={plate}
      kicker="Rediscover"
      title="Saved, but not yet explored"
      sub="Links you never opened, next to the ones you keep coming back to."
      className="stats-rediscover"
    >
      <div className="rediscover-body">
        <div className="rediscover-part">
          <div className="rediscover-head">
            <h4 className="stats-mini-title">
              Forgotten gems
              {gems.total ? <span className="rediscover-count">{plural(gems.total, 'never opened', 'never opened')}</span> : null}
            </h4>
            {pages > 1 ? (
              <MoreLink icon={Shuffle} onClick={() => setPage((page + 1) % pages)}>
                Show others
              </MoreLink>
            ) : null}
          </div>
          {shown.length ? (
            <ul className="stats-links rediscover-gems" aria-live="polite">
              {shown.map(link => (
                <LinkRow key={link.id} link={link} side={<CategoryTag name={link.category} />} onOpenLink={onOpenLink} />
              ))}
            </ul>
          ) : (
            <p className="stats-calm">
              {mostOpened.length
                ? 'You have opened every link you saved. Nothing is forgotten.'
                : 'Links you save but never open show up here, so you can rediscover them.'}
            </p>
          )}
        </div>
        <div className="rediscover-part">
          <div className="rediscover-head">
            <h4 className="stats-mini-title">Most opened</h4>
          </div>
          {mostOpened.length ? (
            <ol className="stats-links rediscover-top">
              {mostOpened.map((link, i) => (
                <LinkRow
                  key={link.id}
                  link={link}
                  sub={link.openedAt ? `Opened ${timeAgo(link.openedAt)}` : undefined}
                  side={
                    <span className="rediscover-opens" title={`Opened ${plural(link.opens, 'time')}`}>
                      <span className="rediscover-rank" aria-hidden="true">
                        #{i + 1}
                      </span>
                      {plural(link.opens, 'open')}
                    </span>
                  }
                  onOpenLink={onOpenLink}
                />
              ))}
            </ol>
          ) : (
            <p className="stats-calm">The links you open most will show up here.</p>
          )}
        </div>
      </div>
    </Card>
  );
}
