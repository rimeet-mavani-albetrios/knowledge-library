// The compare window's "Website facts" rows, from the facts the robot finds about each website: how popular it is,
// its app's rating, its trust grade, the company behind it (and its country), when it was founded, and how often its
// prices changed. One question to the server brings them for all the links in the window. Like every compare row, a
// row only shows when at least one of the links has that fact, so the section is simply missing while the facts are
// still being collected.
// The facts come a moment after the links. While they load, the facts already known for links still in the window
// stay (taking a column out with × doesn't make the section blink away and back), and `ready` tells the window when
// every link's facts are in, so what depends on them (the quick verdict's marks, the number of differences) waits.
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Star, ThumbsUp, TrendingUp } from 'lucide-react';
import { api } from '../api.js';
import { compactNumber, timeAgo } from '../format.js';
import { countryName, countryOf } from './country-names.js';
import Flag from './Flag.jsx';
import './compare-facts.css';

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];
// How often a plan is paid, after its price (the same words as the details window's price watch).
const PERIODS = { month: '/ month', year: '/ year', once: 'once', 'user/month': '/ user / month', 'user/year': '/ user / year' };

// The facts of the last links shown that are still in the window, to show while the new set loads.
function keptFacts(previous, key) {
  if (!previous?.items) return undefined;
  const kept = key.split(',').filter(id => previous.items[id]);
  return kept.length ? { items: Object.fromEntries(kept.map(id => [id, previous.items[id]])) } : undefined;
}

// { items, ready } for the links in the window (`key` is their ids, joined by commas). `items` is
// { [link id]: { facts, priceChanges, lastPrice } } (the server sends one for every link, facts or not); `ready`
// is true once every link has its entry, or when the facts couldn't load (the table then goes on without them).
export function useCompareFacts(key) {
  const query = useQuery({
    queryKey: ['compare-facts', key],
    queryFn: () => api(`/compare/facts?ids=${encodeURIComponent(key)}`),
    enabled: Boolean(key),
    staleTime: 60_000,
    placeholderData: previous => keptFacts(previous, key),
  });
  const items = query.data?.items;
  const ready = query.isError || Boolean(key && items && key.split(',').every(id => items[id]));
  return { items, ready };
}

const number = value => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function priceText({ data = {} } = {}) {
  const amount = value => (number(value) === null ? String(value ?? '?') : `${number(value).toLocaleString()}`);
  const currency = data.currency ? ` ${data.currency}` : '';
  const period = PERIODS[data.period] ? ` ${PERIODS[data.period]}` : ''; // "20 → 25 USD / month"
  return `${data.plan ? `${data.plan}: ` : ''}${amount(data.from)} → ${amount(data.to)}${currency}${period}`;
}

// The section for the compare table, or null when nobody has any facts yet. `winners(links, score, highest)` is the
// compare window's own "who wins this row" helper, so the marks look the same as the other rows'.
export function factsSection(links, items, winners) {
  if (!items) return null;
  const of = link => items[link.id] ?? { facts: {}, priceChanges: 0, lastPrice: null };
  const facts = link => of(link).facts ?? {};
  const bucket = link => number(facts(link).popularity?.bucket);
  const ios = link => facts(link).app?.ios ?? null;
  const rating = link => number(ios(link)?.rating);
  const grade = link => (GRADES.includes(facts(link).trust?.grade) ? facts(link).trust.grade : '');
  const company = link => facts(link).company ?? {};
  const country = link => countryOf(facts(link)); // the same one country the library's filter and map use
  const owner = link => [company(link).name, country(link)].filter(Boolean).join(' · ');
  const founded = link => number(facts(link).wikidata?.founded);
  const changes = link => of(link).priceChanges ?? 0;
  const known = link => Boolean(items[link.id]); // false for a link just added, while its facts load
  const year = new Date().getFullYear();

  return {
    title: 'Website facts',
    rows: [
      {
        key: 'popularity',
        label: 'Popularity',
        short: true,
        value: link => String(bucket(link) ?? ''),
        text: link => `Top ${bucket(link).toLocaleString()} websites`,
        render: link =>
          bucket(link) ? (
            <>
              Top {compactNumber(bucket(link))}
              <span className="compare-sub">
                websites in the world{facts(link).popularity?.rising ? <span className="cf-rising"> · Rising</span> : null}
              </span>
            </>
          ) : null,
        mark: { label: 'Most popular', Icon: TrendingUp, wins: winners(links, bucket) },
      },
      {
        key: 'app-rating',
        label: 'App rating',
        short: true,
        value: link => (rating(link) ? String(rating(link)) : facts(link).app?.android?.url ? 'android' : ''),
        text: link => (rating(link) ? `${rating(link).toFixed(1)} of 5` : 'Android app'),
        render: link =>
          rating(link) ? (
            <>
              <span className="cf-rating">
                <Star size={14} aria-hidden="true" /> {rating(link).toFixed(1)}
              </span>
              {number(ios(link).ratings) ? <span className="compare-sub">{compactNumber(ios(link).ratings)} ratings on the App Store</span> : null}
            </>
          ) : facts(link).app?.android?.url ? (
            <span className="compare-none">Android app, no rating</span>
          ) : null,
        mark: { label: 'Best rated', Icon: ThumbsUp, wins: winners(links, rating, true) },
      },
      {
        key: 'trust',
        label: 'Trust grade',
        short: true,
        value: grade,
        text: link => `Grade ${grade(link)}`,
        render: link => {
          if (!grade(link)) return null;
          const reasons = facts(link).trust?.reasons ?? [];
          const passed = reasons.filter(reason => reason.ok).length;
          return (
            <>
              <span className={`cf-grade is-${grade(link).toLowerCase()}`}>{grade(link)}</span>
              {reasons.length ? <span className="compare-sub">{passed} of {plural(reasons.length, 'check')} passed</span> : null}
            </>
          );
        },
        mark: { label: 'Most trusted', Icon: ShieldCheck, wins: winners(links, link => (grade(link) ? GRADES.indexOf(grade(link)) : undefined)) },
      },
      {
        key: 'owner',
        label: 'Owner',
        value: owner,
        text: link => [company(link).name, country(link) && countryName(country(link))].filter(Boolean).join(', '),
        render: link =>
          owner(link) ? (
            <>
              {company(link).name || null}
              {country(link) ? (
                <span className={company(link).name ? 'compare-sub' : undefined}>
                  <Flag code={country(link)} /> {countryName(country(link))}
                </span>
              ) : null}
            </>
          ) : null,
      },
      {
        key: 'founded',
        label: 'Founded',
        short: true,
        value: link => String(founded(link) ?? ''),
        render: link => {
          if (!founded(link)) return null;
          const founders = (facts(link).wikidata?.founders ?? []).filter(Boolean);
          const age = year - founded(link);
          return (
            <>
              {founded(link)}
              <span className="compare-sub">
                {founders.length ? `by ${founders.slice(0, 2).join(', ')}${founders.length > 2 ? ' and others' : ''}` : age > 0 ? plural(age, 'year') + ' ago' : 'this year'}
              </span>
            </>
          );
        },
      },
      {
        key: 'price-changes',
        label: 'Price changes',
        short: true,
        value: link => (changes(link) > 0 ? String(changes(link)) : ''),
        text: link => plural(changes(link), 'change'),
        render: link => {
          const last = of(link).lastPrice;
          if (!known(link)) return null;
          // "None seen" only for a website whose prices are watched; one never checked (no pricing page found,
          // a GitHub repository) says so, instead of looking like a price that never changed.
          if (!changes(link)) return <span className="compare-none">{facts(link).prices ? 'None seen' : 'Not tracked'}</span>;
          return (
            <>
              {plural(changes(link), 'change')}
              {last ? (
                <span className="compare-sub">
                  Last: {priceText(last)}, {timeAgo(last.foundAt)}
                </span>
              ) : null}
            </>
          );
        },
      },
    ],
  };
}
