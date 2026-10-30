// The top of the Stats page: the big numbers told as one sentence, like the first line of an atlas.
// "1,030 links from 34 countries, across 28 topics. 13 need a check." Each number is a button: the links open the
// library, the countries and topics jump to their card further down, "need a check" shows the broken links.
// The small line under it says what is new: "+12 this week · last added 2 days ago".
import { timeAgo } from '../../format.js';
import { plural } from './shared.jsx';

// A number button, with the comma or full stop after it (`after`) kept on the same line as it.
function Num({ children, label, onClick, alert = false, after = '' }) {
  return (
    <span className="stats-story-keep">
      <button type="button" className={`stats-story-num${alert ? ' is-alert' : ''}`} onClick={onClick} aria-label={label}>
        {children}
      </button>
      {after}
    </span>
  );
}

// onShow(filters) shows the library with those filters; onJump(id) scrolls to a card of this page.
export function Story({ totals, onShow, onJump }) {
  const { links, countries, categories, dead, thisWeek, lastAdded } = totals;
  if (!links) {
    return (
      <div className="stats-story">
        <p className="stats-story-line">Your library is empty for now.</p>
        <p className="stats-story-sub">Add a link and this page fills in: topics, countries, prices and more.</p>
      </div>
    );
  }
  return (
    <div className="stats-story">
      <p className="stats-story-line">
        <Num label={`${plural(links, 'link')}: show them all in the library`} onClick={() => onShow({})} after={countries ? '' : ','}>
          {plural(links, 'link')}
        </Num>
        {countries ? (
          <>
            {' from '}
            <Num
              label={`${plural(countries, 'country', 'countries')}: go to the globe`}
              onClick={() => onJump('stats-where')}
              after=","
            >
              {plural(countries, 'country', 'countries')}
            </Num>
          </>
        ) : null}
        {' across '}
        <Num label={`${plural(categories, 'topic')}: go to the topics mosaic`} onClick={() => onJump('stats-topics')} after=".">
          {plural(categories, 'topic')}
        </Num>{' '}
        {dead ? (
          <Num
            alert
            label={`${dead.toLocaleString()} may be broken: show them in the library`}
            onClick={() => onShow({ broken: true })}
            after="."
          >
            {dead.toLocaleString()} {dead === 1 ? 'needs' : 'need'} a check
          </Num>
        ) : (
          <span className="stats-story-calm">All of them open fine.</span>
        )}
      </p>
      <p className="stats-story-sub">
        <span className={thisWeek ? 'stats-story-new' : ''}>{thisWeek ? `+${thisWeek.toLocaleString()} this week` : 'Nothing new this week'}</span>
        {lastAdded ? (
          <>
            <span aria-hidden="true"> · </span>
            <span>last added {timeAgo(lastAdded)}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
