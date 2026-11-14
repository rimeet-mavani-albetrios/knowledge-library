// The Stats page ("Stats" in the top bar): an atlas of your library, laid out as a "bento box" of cards of different
// sizes that fit together without holes (one column on a phone). From the top:
//   the story: one big sentence with the main numbers, each one a button ("1,030 links from 34 countries…")
//   01 Topics      a mosaic of colored tiles, one per category, sized by its links
//   02 Health      a ring: links that work, may be broken, or wait to be checked
//   03 Prices      one bar: free, open source, free plan, paid, not known
//   04 Origins     a 3D Earth and all the countries; clicking one flies there and opens its profile right here
//   05 Rhythm      a calendar of the year: the days you added (or last opened) links
//   06 Rediscover  links you never opened, and the ones you open the most
//   07 Lineage     the oldest and newest companies (only when their founding years are known)
//   08 This week   what changed on your links, and the ones that may be broken
// Clicking a topic, "need a check" or "Show all … in the library" shows those links in the library; Back comes back.
// The website facts fill in day by day, so every part has a calm "not yet" look of its own.
// The parts live in ./stats/ as named exports. A file there with a default export is an extra card that joins the
// end of the page and gets { stats, owner } (like the weekly email card, which sits beside "This week").
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Activity } from './stats/activity.jsx';
import { Changes } from './stats/changes.jsx';
import { CompanyAges } from './stats/company-ages.jsx';
import { Health, PriceMix } from './stats/gauges.jsx';
import { Mosaic } from './stats/mosaic.jsx';
import { Rediscover } from './stats/rediscover.jsx';
import { motion } from './stats/shared.jsx';
import { Story } from './stats/story.jsx';
import { Where } from './stats/where.jsx';
import './stats.css';

const EXTRA_CARDS = Object.entries(import.meta.glob('./stats/*.jsx', { eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, module]) => ({ key: file, Card: module.default }))
  .filter(({ Card }) => typeof Card === 'function');

// The visitor's minutes ahead of UTC (India: 330), so the calendar's days are their own days, not London's.
const utcOffset = () => -new Date().getTimezoneOffset();
export const statsQuery = { queryKey: ['stats'], queryFn: () => api(`/stats?offset=${utcOffset()}`), staleTime: 60_000 };

const today = () => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

// Grey cards in the same places and about the same sizes as the real ones, so nothing jumps when the numbers come.
const SKELETON = ['mosaic', 'health', 'prices', 'where', 'activity', 'rediscover', 'ages', 'changes'];

function Loading({ owner }) {
  return (
    <div className={`stats-bento has-ages${owner ? ' has-side' : ''}`} aria-busy="true" aria-label="Loading the numbers">
      {SKELETON.map(name => (
        <div key={name} className={`stats-card stats-${name} is-skeleton`} />
      ))}
      {owner ? <div className="stats-card stats-email is-skeleton" /> : null}
    </div>
  );
}

function StoryLoading() {
  return (
    <div className="stats-story is-loading" aria-hidden="true">
      <p className="stats-story-line">
        <span className="stats-bone" style={{ width: '88%' }} />
        <span className="stats-bone" style={{ width: '46%' }} />
      </p>
      <p className="stats-story-sub">
        <span className="stats-bone is-thin" style={{ width: 220 }} />
      </p>
    </div>
  );
}

// onBack() goes back to the library; onShow(filters) shows the library with only those filters on;
// onOpenLink(id) opens a link's details on top of this page.
export default function StatsPage({ owner, onBack, onShow, onOpenLink }) {
  const stats = useQuery(statsQuery);
  const data = stats.data;
  // "34 countries" and "28 topics" in the story jump to their card, and the card takes the focus (for screen readers).
  const jump = id => {
    const card = document.getElementById(id);
    if (!card) return;
    card.scrollIntoView({ behavior: motion(), block: 'start' });
    card.focus({ preventScroll: true });
  };
  // The cards are numbered like the plates of an atlas, in the order they show.
  let count = 0;
  const plate = () => String(++count).padStart(2, '0');
  const ages = Boolean(data?.companies?.total);
  const side = owner && EXTRA_CARDS.length > 0; // the weekly email card sits beside "This week"

  return (
    <main className="container stats-page" id="stats" aria-labelledby="stats-title">
      <header className="stats-head">
        <div className="stats-masthead">
          <button type="button" className="btn btn-ghost stats-back" onClick={onBack}>
            <ArrowLeft size={17} aria-hidden="true" /> Library
          </button>
          <h2 id="stats-title" className="stats-title">
            Your library in numbers
          </h2>
          <span className="stats-rule" aria-hidden="true" />
          <span className="stats-dateline">{today()}</span>
        </div>
        {data ? <Story totals={data.totals} onShow={onShow} onJump={jump} /> : stats.isError ? null : <StoryLoading />}
      </header>

      {stats.isError ? (
        <div className="empty">
          <h2>The numbers didn’t load</h2>
          <p>{stats.error.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => stats.refetch()}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : !data ? (
        <Loading owner={owner} />
      ) : (
        <div className={`stats-bento${ages ? ' has-ages' : ''}${side ? ' has-side' : ''}`}>
          <Mosaic categories={data.categories} plate={plate()} onShow={onShow} />
          <Health health={data.health} total={data.totals.links} plate={plate()} onShow={onShow} />
          <PriceMix pricing={data.pricing} total={data.totals.links} plate={plate()} onShow={onShow} />
          <Where data={data} plate={plate()} onShow={onShow} onOpenLink={onOpenLink} />
          <Activity activity={data.activity} totals={data.totals} plate={plate()} />
          <Rediscover gems={data.gems} mostOpened={data.mostOpened} plate={plate()} onOpenLink={onOpenLink} />
          {ages ? <CompanyAges companies={data.companies} plate={plate()} onOpenLink={onOpenLink} /> : null}
          <Changes changes={data.changes} broken={data.broken} plate={plate()} onShow={onShow} onOpenLink={onOpenLink} />
          {EXTRA_CARDS.map(({ key, Card }) => (
            <Card key={key} stats={data} owner={owner} />
          ))}
        </div>
      )}
    </main>
  );
}
