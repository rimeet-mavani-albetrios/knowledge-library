// "Price watch" on the History tab: the price changes found so far (newest first) and the plans as they are now.
// The robot reads the pricing page once a month (server/facts/kinds/prices.js). Its first visit is the starting
// point, so the list of changes starts empty. A rise in the last 30 days also shows as a chip at the top.
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { fullDate, hostOf } from '../../../format.js';
import './watch.css';

const DAY = 24 * 60 * 60 * 1000;
const PERIODS = { month: '/ month', year: '/ year', once: 'once', 'user/month': '/ user / month', 'user/year': '/ user / year' };

const newestFirst = rows => [...(rows ?? [])].sort((a, b) => new Date(b.at) - new Date(a.at));

export const tab = 'history';
export const order = 20;

// "$25", "€6,990", "₹1,499.50": in the plan's own currency.
function money(price, currency) {
  const digits = price % 1 ? 2 : 0;
  try {
    if (currency) {
      return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(price);
    }
  } catch {
    // An unknown currency code: the number alone.
  }
  return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(price);
}

const priceText = plan => (plan.price === null ? 'Custom' : plan.price === 0 ? 'Free' : money(plan.price, plan.currency));

// The last rise, when it was in the last 30 days.
const recentRise = prices => (prices?.upAt && Date.now() - new Date(prices.upAt) < 30 * DAY ? prices.upAt : null);

export function glance(facts) {
  return recentRise(facts?.prices) ? { icon: TrendingUp, text: 'Price went up', tab: 'history', tone: 'warn' } : null;
}

export default function PriceWatch({ facts, history }) {
  const prices = facts?.prices;
  const plans = prices?.plans ?? [];
  const changes = newestFirst(history?.price);
  if (!plans.length && !changes.length) return null;
  const rise = recentRise(prices);

  return (
    <section className="detail-section watch">
      <h3>Price watch</h3>
      {rise ? (
        <p className="watch-alert">
          <TrendingUp size={15} aria-hidden="true" /> Price went up on {fullDate(rise)}
        </p>
      ) : null}

      {changes.length ? (
        <ul className="watch-changes" aria-label="Price changes">
          {changes.map((change, index) => {
            const up = change.to > change.from;
            const Arrow = up ? TrendingUp : TrendingDown;
            return (
              <li key={`${index}-${change.at}`} className={up ? 'is-up' : 'is-down'}>
                <time dateTime={change.at}>{fullDate(change.at)}</time>
                <span className="watch-plan">{change.plan}</span>
                <span className="watch-move">
                  <Arrow size={14} aria-hidden="true" />
                  <s>{money(change.from, change.currency)}</s> → <strong>{money(change.to, change.currency)}</strong>
                  {PERIODS[change.period] ? <span className="watch-period"> {PERIODS[change.period]}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="watch-quiet">No price changes yet. The pricing page is checked once a month.</p>
      )}

      {plans.length ? (
        <>
          <h4 className="watch-subhead">Plans now</h4>
          <dl className="watch-plans">
            {plans.map(plan => (
              <div key={`${plan.name}-${plan.period}`}>
                <dt>{plan.name}</dt>
                <dd>
                  <strong>{priceText(plan)}</strong>
                  {plan.price ? <span className="watch-period"> {PERIODS[plan.period] ?? ''}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
          {prices.url ? (
            <a className="watch-source" href={prices.url} target="_blank" rel="noopener noreferrer">
              From {hostOf(prices.url)}’s pricing page <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
