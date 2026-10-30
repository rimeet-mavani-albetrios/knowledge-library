// "This week": what the robot noticed on your links in the last 7 days (new prices, new features, websites getting
// popular, links that stopped working), and next to it the links that may be broken right now.
// Click a row to open that link's details on top of the page.
import { useState } from 'react';
import { ArrowDown, ArrowUp, BadgeDollarSign, RefreshCw, Sparkle, TrendingUp, Unlink, CircleCheck } from 'lucide-react';
import { fullDateTime, timeAgo } from '../../format.js';
import { MoreLink, Reveal, SeeMore } from '../SeeMore.jsx';
import { Card, LinkRow, plural } from './shared.jsx';
import './changes.css';

const BROKEN_SHOWN = 5;
const CHANGES_SHOWN = 6; // the others open under them, with "Show all"

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

// What a change says: { Icon, tone, label, text }.
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
  return { Icon: Unlink, tone: 'danger', label: 'Stopped working', text: 'Didn’t open at the last check' };
}

function ChangeRow({ link, change, when, onOpenLink }) {
  const { Icon, tone, label, text } = change;
  return (
    <LinkRow
      link={link}
      sub={text}
      onOpenLink={onOpenLink}
      side={
        <span className="change-side">
          <span className={`change-kind is-${tone}`}>
            <Icon size={13} aria-hidden="true" /> {label}
          </span>
          {when ? (
            <span className="change-when" title={fullDateTime(when)}>
              {timeAgo(when)}
            </span>
          ) : null}
        </span>
      }
    />
  );
}

export function Changes({ changes, broken, plate, onShow, onOpenLink }) {
  const [allChanges, setAllChanges] = useState(false);
  const firstChanges = changes.items.slice(0, CHANGES_SHOWN);
  const otherChanges = changes.items.slice(CHANGES_SHOWN);
  const changeRow = item => <ChangeRow key={item.id} link={item.link} change={describe(item)} when={item.foundAt} onOpenLink={onOpenLink} />;
  // A link that died this week is in the week's list already: "May be broken" doesn't show it twice.
  const diedNow = new Set(changes.items.filter(item => item.kind === 'dead').map(item => item.link.id));
  const stillBroken = broken.items.filter(link => !diedNow.has(link.id)).slice(0, BROKEN_SHOWN);

  return (
    <Card
      id="stats-changes"
      plate={plate}
      kicker="This week"
      title="What changed on your links"
      sub="New prices, new features and links that stopped working, from the last 7 days."
      className="stats-changes"
    >
      <div className="changes-body">
        <div className="changes-part">
          <h4 className="stats-mini-title">Changes</h4>
          {changes.items.length ? (
            <>
              <ul className="stats-links">{firstChanges.map(changeRow)}</ul>
              {otherChanges.length ? (
                <>
                  <Reveal open={allChanges} id="stats-changes-more">
                    <ul className="stats-links">{otherChanges.map(changeRow)}</ul>
                  </Reveal>
                  <SeeMore
                    open={allChanges}
                    more={`Show all ${changes.items.length} changes`}
                    controls="stats-changes-more"
                    onClick={() => setAllChanges(!allChanges)}
                    className="stats-more"
                  />
                </>
              ) : null}
            </>
          ) : (
            <div className="stats-empty">
              <RefreshCw size={20} aria-hidden="true" />
              <strong>Nothing changed this week</strong>
              <span>The robot checks prices, features and links every day. What it finds shows up here.</span>
            </div>
          )}
          {changes.total > changes.items.length ? (
            <p className="stats-quiet">And {plural(changes.total - changes.items.length, 'more change')}.</p>
          ) : null}
        </div>
        <div className="changes-part">
          <h4 className="stats-mini-title">May be broken</h4>
          {broken.total > 0 ? (
            <>
              {stillBroken.length ? (
                <ul className="stats-links">
                  {stillBroken.map(link => (
                    <ChangeRow
                      key={link.id}
                      link={link}
                      change={{ Icon: Unlink, tone: 'danger', label: 'Broken', text: 'Didn’t open at the last check' }}
                      when={link.checkedAt}
                      onOpenLink={onOpenLink}
                    />
                  ))}
                </ul>
              ) : null}
              <MoreLink onClick={() => onShow({ broken: true })} className="stats-more">
                See all {plural(broken.total, 'link')} that may be broken
              </MoreLink>
            </>
          ) : (
            <div className="stats-empty">
              <CircleCheck size={20} aria-hidden="true" />
              <strong>Every link opens</strong>
              <span>When a page stops opening, it shows up here so you can fix or delete it.</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
