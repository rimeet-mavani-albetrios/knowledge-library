// The Stats page ("Stats" in the top bar): your library in numbers. Four number boxes, a world map of where the
// companies behind your tools are, how many links you saved each month, the biggest categories, and what changed
// this week (prices, new features, links that stopped working). Clicking a country, a category or a number shows
// those links in the library; Back comes back here.
// The website facts fill in day by day, so every part has a calm "not yet" look of its own.
// More cards can join the end of the page: each file in ./stats/ default-exports a component that gets
// { stats, owner } (like the weekly email card).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown, ArrowLeft, ArrowUp, BadgeDollarSign, CalendarDays, Earth, Library, RefreshCw, Sparkle, TrendingUp, Unlink,
} from 'lucide-react';
import { api } from '../api.js';
import { categoryStyle, hueOf } from '../categories.jsx';
import { fullDate, fullDateTime, timeAgo } from '../format.js';
import { SiteIcon } from './LinkCard.jsx';
import WorldMap from './WorldMap.jsx';
import { countryFlag, countryName } from './country-names.js';
import './stats.css';

const EXTRA_CARDS = Object.entries(import.meta.glob('./stats/*.jsx', { eager: true }))
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, module]) => ({ key: file, Card: module.default }))
  .filter(({ Card }) => typeof Card === 'function');

const COUNTRIES_SHOWN = 8;
const CATEGORIES_SHOWN = 8;
const BROKEN_SHOWN = 5;
const UNKNOWN = 'unknown'; // the country filter's value for "not known yet"

export const statsQuery = { queryKey: ['stats'], queryFn: () => api('/stats'), staleTime: 60_000 };

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---------- The four numbers at the top ----------

function NumberBox({ Icon, tone, value, label, sub, onClick, action }) {
  const inside = (
    <>
      <span className={`stats-num-icon is-${tone}`} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="stats-num-value">{value.toLocaleString()}</span>
      <span className="stats-num-label">{label}</span>
      <span className="stats-num-sub">{sub}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="stats-num is-button" onClick={onClick} title={action}>
      {inside}
    </button>
  ) : (
    <div className="stats-num">{inside}</div>
  );
}

function Numbers({ totals, onShow }) {
  const { links, countries, priceChanges, dead, thisMonth, withFacts, unknownCountry } = totals;
  return (
    <section className="stats-numbers" aria-label="Your library in numbers">
      <NumberBox
        Icon={Library}
        tone="accent"
        value={links}
        label={links === 1 ? 'Link' : 'Links'}
        sub={thisMonth ? `+${thisMonth.toLocaleString()} this month` : 'Saved so far'}
      />
      <NumberBox
        Icon={Earth}
        tone="teal"
        value={countries}
        label={countries === 1 ? 'Country' : 'Countries'}
        sub={
          !withFacts
            ? 'Being found out now'
            : countries
              ? `${plural(links - unknownCountry, 'link')} placed so far`
              : 'None found yet'
        }
      />
      <NumberBox
        Icon={BadgeDollarSign}
        tone="gold"
        value={priceChanges}
        label={priceChanges === 1 ? 'Price change' : 'Price changes'}
        sub="This month"
      />
      <NumberBox
        Icon={Unlink}
        tone={dead ? 'danger' : 'success'}
        value={dead}
        label={dead === 1 ? 'Dead link' : 'Dead links'}
        sub={dead ? 'May be broken. Click to see them' : 'All your links work'}
        onClick={dead ? () => onShow({ broken: true }) : undefined}
        action="Show the links that may be broken"
      />
    </section>
  );
}

// ---------- Where your tools come from ----------

function Countries({ data, onPickCountry }) {
  const [all, setAll] = useState(false);
  const values = useMemo(() => Object.fromEntries(data.countries.map(({ country, count }) => [country, count])), [data.countries]);
  const { withFacts, unknownCountry } = data.totals;
  const shown = all ? data.countries : data.countries.slice(0, COUNTRIES_SHOWN);
  const top = data.countries[0]?.count ?? 0;
  const empty = data.countries.length === 0;
  return (
    <section className="stats-card stats-where" aria-labelledby="stats-where">
      <header className="stats-card-head">
        <h3 id="stats-where">Where your tools come from</h3>
        <p>The country of the company behind each website. Click a country to see its links.</p>
      </header>
      <div className="stats-where-body">
        <div className="stats-map">
          <WorldMap
            values={values}
            onPick={onPickCountry}
            label="World map of where the companies behind your links are"
            format={n => (n ? plural(n, 'link') : 'No links')}
          />
          {empty ? (
            <div className="stats-map-note">
              <Earth size={22} aria-hidden="true" />
              <strong>{withFacts ? 'No countries found yet' : 'Countries are being found out'}</strong>
              <span>
                The robot reads each website’s Terms page and Wikidata to learn where the company is. Countries color in
                here as it goes.
              </span>
            </div>
          ) : null}
        </div>
        <div className="stats-countries">
          <h4 className="stats-mini-title">Top countries</h4>
          {empty ? (
            <p className="stats-quiet">None yet.</p>
          ) : (
            <ol className="stats-bars" aria-label="Countries with the most links">
              {shown.map(({ country, count }) => (
                <li key={country}>
                  <button type="button" className="stats-bar-row" onClick={() => onPickCountry(country)}>
                    <span className="stats-bar-name">
                      <span className="stats-flag" aria-hidden="true">
                        {countryFlag(country)}
                      </span>
                      {countryName(country)}
                    </span>
                    <span className="stats-bar-count">{count.toLocaleString()}</span>
                    <span className="stats-bar-track" aria-hidden="true">
                      <span className="stats-bar-fill stats-fill-teal" style={{ width: `${(count / top) * 100}%` }} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {data.countries.length > COUNTRIES_SHOWN ? (
            <button type="button" className="link-btn stats-more" aria-expanded={all} onClick={() => setAll(!all)}>
              {all ? 'Show fewer' : `Show all ${data.countries.length} countries`}
            </button>
          ) : null}
          {unknownCountry > 0 ? (
            <button type="button" className="stats-unknown" onClick={() => onPickCountry(UNKNOWN)}>
              <span>Not known yet</span>
              <span className="stats-bar-count">{unknownCountry.toLocaleString()}</span>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ---------- Saved per month ----------

const monthName = (month, style = 'short') => {
  const [year, number] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { month: style, year: style === 'long' ? 'numeric' : undefined }).format(
    new Date(Date.UTC(year, number - 1, 15)),
  );
};

function Months({ data }) {
  const { months, busiestDay, totals } = data;
  const max = Math.max(1, ...months.map(month => month.count));
  // One big import makes one tall bar and empty months around it: say why, so it doesn't look broken.
  const imported = busiestDay && totals.links >= 20 && busiestDay.count / totals.links > 0.6;
  return (
    <section className="stats-card" aria-labelledby="stats-months">
      <header className="stats-card-head">
        <h3 id="stats-months">Saved per month</h3>
        <p>How many links you added each month.</p>
      </header>
      <ol className="stats-months" aria-label="Links saved per month">
        {months.map(({ month, count }, i) => {
          const year = month.slice(0, 4);
          const newYear = i === 0 || month.endsWith('-01');
          return (
            <li key={month} className="stats-month" title={`${monthName(month, 'long')}: ${plural(count, 'link')}`}>
              <span className="stats-month-value">{count ? count.toLocaleString() : ''}</span>
              <span className="stats-month-bar">
                <span className={count ? '' : 'is-zero'} style={{ height: count ? `${Math.max(3, (count / max) * 100)}%` : undefined }} />
              </span>
              <span className="stats-month-name">{monthName(month)}</span>
              <span className="stats-month-year">{newYear ? year : ''}</span>
              <span className="sr-only">{plural(count, 'link')}</span>
            </li>
          );
        })}
      </ol>
      {imported ? (
        <p className="stats-foot-note">
          <CalendarDays size={15} aria-hidden="true" />
          {busiestDay.count === totals.links ? 'All' : busiestDay.count.toLocaleString()} of your links came in on{' '}
          {fullDate(busiestDay.day)}, when you brought them in. Links you add from now on fill in the other months.
        </p>
      ) : null}
    </section>
  );
}

// ---------- Top categories ----------

function Categories({ data, onShow }) {
  const [all, setAll] = useState(false);
  const list = data.categories;
  const shown = all ? list : list.slice(0, CATEGORIES_SHOWN);
  const top = list[0]?.count ?? 1;
  return (
    <section className="stats-card" aria-labelledby="stats-categories">
      <header className="stats-card-head">
        <h3 id="stats-categories">Top categories</h3>
        <p>What most of your links are about. Click one to see its links.</p>
      </header>
      {list.length ? (
        <ol className="stats-bars" aria-label="Categories with the most links">
          {shown.map(({ value, count }) => {
            const { Icon } = categoryStyle(value);
            return (
              <li key={value} style={hueOf(value)}>
                <button type="button" className="stats-bar-row" onClick={() => onShow({ category: value })}>
                  <span className="stats-bar-name">
                    <Icon size={15} aria-hidden="true" className="stats-cat-icon" />
                    {value}
                  </span>
                  <span className="stats-bar-count">{count.toLocaleString()}</span>
                  <span className="stats-bar-track" aria-hidden="true">
                    <span className="stats-bar-fill stats-fill-hue" style={{ width: `${(count / top) * 100}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="stats-quiet">No links yet.</p>
      )}
      {list.length > CATEGORIES_SHOWN ? (
        <button type="button" className="link-btn stats-more" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${list.length} categories`}
        </button>
      ) : null}
    </section>
  );
}

// ---------- Changes this week ----------

// "$12", or "12 USD" when the currency isn't a known code. Text prices ("Custom") stay as they are.
function money(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '?';
  const number = Number(amount);
  if (!Number.isFinite(number)) return String(amount);
  try {
    if (/^[A-Z]{3}$/.test(currency ?? '')) {
      return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: number % 1 ? 2 : 0 }).format(number);
    }
  } catch {
    // an unknown currency code: the number with the code after it
  }
  return `${number.toLocaleString()}${currency ? ` ${currency}` : ''}`;
}

const topText = bucket => (Number(bucket) > 0 ? `top ${Number(bucket).toLocaleString()}` : 'unranked');

// What a change says: { Icon, tone, text }.
function describe({ kind, data = {} }) {
  if (kind === 'price') {
    const up = Number(data.to) > Number(data.from);
    const down = Number(data.to) < Number(data.from);
    const period = data.period ? ` / ${data.period}` : '';
    return {
      Icon: up ? ArrowUp : down ? ArrowDown : BadgeDollarSign,
      tone: up ? 'danger' : down ? 'success' : 'gold',
      label: up ? 'Price up' : down ? 'Price down' : 'Price changed',
      text: `${data.plan ? `${data.plan}: ` : ''}${money(data.from, data.currency)} → ${money(data.to, data.currency)}${period}`,
    };
  }
  if (kind === 'feature') return { Icon: Sparkle, tone: 'accent', label: 'New feature', text: data.name ?? 'Something new' };
  if (kind === 'rising') {
    return { Icon: TrendingUp, tone: 'teal', label: 'Getting popular', text: `From ${topText(data.from)} to ${topText(data.to)} websites` };
  }
  return { Icon: Unlink, tone: 'danger', label: 'Stopped working', text: 'The page did not open at the last check' };
}

function ChangeRow({ link, change, when, onOpenLink }) {
  const { Icon, tone, label, text } = change;
  return (
    <li>
      <button type="button" className="stats-change" onClick={() => onOpenLink(link.id)}>
        <SiteIcon link={link} className="row-icon stats-change-icon" />
        <span className="stats-change-text">
          <span className="stats-change-title">{link.title || link.url}</span>
          <span className="stats-change-what">{text}</span>
        </span>
        <span className="stats-change-side">
          <span className={`stats-change-kind is-${tone}`}>
            <Icon size={13} aria-hidden="true" /> {label}
          </span>
          {when ? (
            <span className="stats-change-when" title={fullDateTime(when)}>
              {timeAgo(when)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function Changes({ data, onShow, onOpenLink }) {
  const { changes, broken } = data;
  // A link that died this week is in the list already: the "May be broken" part doesn't show it twice.
  const diedNow = new Set(changes.items.filter(item => item.kind === 'dead').map(item => item.link.id));
  const stillBroken = broken.items.filter(link => !diedNow.has(link.id)).slice(0, BROKEN_SHOWN);
  return (
    <section className="stats-card stats-changes" aria-labelledby="stats-changes">
      <header className="stats-card-head">
        <h3 id="stats-changes">Changes this week</h3>
        <p>New prices, new features and links that stopped working, from the last 7 days.</p>
      </header>
      {!changes.items.length ? (
        <div className="stats-empty">
          <RefreshCw size={20} aria-hidden="true" />
          <strong>Nothing changed this week</strong>
          <span>The robot checks prices, features and links every day. What it finds shows up here.</span>
        </div>
      ) : (
        <ul className="stats-change-list">
          {changes.items.map(item => (
            <ChangeRow key={item.id} link={item.link} change={describe(item)} when={item.foundAt} onOpenLink={onOpenLink} />
          ))}
        </ul>
      )}
      {changes.total > changes.items.length ? (
        <p className="stats-quiet">And {plural(changes.total - changes.items.length, 'more change')}.</p>
      ) : null}
      {broken.total > 0 ? (
        <>
          <h4 className="stats-mini-title stats-broken-title">May be broken</h4>
          <ul className="stats-change-list">
            {stillBroken.map(link => (
              <ChangeRow
                key={link.id}
                link={link}
                change={{ Icon: Unlink, tone: 'danger', label: 'Broken', text: 'The page did not open at the last check' }}
                when={link.checkedAt}
                onOpenLink={onOpenLink}
              />
            ))}
          </ul>
          <button type="button" className="link-btn stats-more" onClick={() => onShow({ broken: true })}>
            See all {plural(broken.total, 'link')} that may be broken
          </button>
        </>
      ) : null}
    </section>
  );
}

// ---------- The page ----------

function Loading() {
  return (
    <div className="stats-loading" aria-busy="true" aria-label="Loading the numbers">
      <div className="stats-numbers">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stats-num is-skeleton" />
        ))}
      </div>
      <div className="stats-card is-skeleton stats-where" />
      <div className="stats-grid">
        <div className="stats-card is-skeleton" />
        <div className="stats-card is-skeleton" />
      </div>
    </div>
  );
}

// onBack() goes back to the library; onShow(filters) shows the library with only those filters on;
// onOpenLink(id) opens a link's details on top of this page.
export default function StatsPage({ owner, onBack, onShow, onOpenLink }) {
  const stats = useQuery(statsQuery);
  const data = stats.data;
  const pickCountry = country => onShow({ country });
  return (
    <main className="container stats-page" id="stats" aria-labelledby="stats-title">
      <div className="stats-head">
        <button type="button" className="btn btn-ghost stats-back" onClick={onBack}>
          <ArrowLeft size={17} aria-hidden="true" /> Library
        </button>
        <div className="stats-head-text">
          <h2 id="stats-title" className="stats-title">
            Your library in numbers
          </h2>
          <p className="stats-sub">Where your tools come from, what you saved, and what changed. Facts about each website fill in day by day.</p>
        </div>
      </div>

      {stats.isError ? (
        <div className="empty">
          <h2>The numbers didn’t load</h2>
          <p>{stats.error.message}</p>
          <button type="button" className="btn btn-ghost" onClick={() => stats.refetch()}>
            <RefreshCw size={16} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <Numbers totals={data.totals} onShow={onShow} />
          <Countries data={data} onPickCountry={pickCountry} />
          {/* Two columns that each stack their cards, so a short card leaves no hole beside a long one. */}
          <div className="stats-grid">
            <div className="stats-col">
              <Months data={data} />
              <Changes data={data} onShow={onShow} onOpenLink={onOpenLink} />
            </div>
            <div className="stats-col">
              <Categories data={data} onShow={onShow} />
              {EXTRA_CARDS.map(({ key, Card }) => (
                <Card key={key} stats={data} owner={owner} />
              ))}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
