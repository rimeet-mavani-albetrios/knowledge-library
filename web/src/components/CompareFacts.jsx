// The compare window's "Website facts" rows, from the facts the robot finds about each website: how popular it is,
// its app's rating, its trust grade, the company behind it (and its country), when it was founded, and how often its
// prices changed. One question to the server brings them for all the links in the window. Like every compare row, a
// row only shows when at least one of the links has that fact, so the section is simply missing while the facts are
// still being collected.
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Star, ThumbsUp, TrendingUp } from 'lucide-react';
import { api } from '../api.js';
import { compactNumber, timeAgo } from '../format.js';
import { countryFlag, countryName } from './country-names.js';
import './compare-facts.css';

const GRADES = ['A', 'B', 'C', 'D', 'E', 'F'];

// { [link id]: { facts, priceChanges, lastPrice } } for the links in the window (`key` is their ids, joined by commas).
export function useCompareFacts(key) {
  return useQuery({
    queryKey: ['compare-facts', key],
    queryFn: () => api(`/compare/facts?ids=${encodeURIComponent(key)}`),
    enabled: Boolean(key),
    staleTime: 60_000,
  }).data?.items;
}

const number = value => (value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function priceText({ data = {} } = {}) {
  const amount = value => (number(value) === null ? String(value ?? '?') : `${number(value).toLocaleString()}`);
  const currency = data.currency ? ` ${data.currency}` : '';
  return `${data.plan ? `${data.plan}: ` : ''}${amount(data.from)} → ${amount(data.to)}${currency}`;
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
  const country = link => {
    const code = String(company(link).country || facts(link).wikidata?.country || '').toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : '';
  };
  const owner = link => [company(link).name, country(link)].filter(Boolean).join(' · ');
  const founded = link => number(facts(link).wikidata?.founded);
  const changes = link => of(link).priceChanges ?? 0;
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
                  {countryFlag(country(link))} {countryName(country(link))}
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
          if (!changes(link)) return <span className="compare-none">None seen</span>;
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
