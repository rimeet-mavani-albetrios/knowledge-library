// A country's profile: what opens when you click a country on the Stats page's globe or in its list. Big flag and name,
// its place among your countries, then what's from there, what it costs, who is behind it, a few quiet facts and its
// top links. The first line is known at once, the rest comes from /stats/country/:code (grey shapes until then, of
// about the same size, so nothing jumps). "Not known yet" works the same, with a line about why.
// (Only named exports here: a file in this folder with a default export becomes an extra card, see StatsPage.jsx.)
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleHelp, ExternalLink, RefreshCw, ShieldCheck, Star, X } from 'lucide-react';
import { api } from '../../api.js';
import { categoryStyle, hueOf } from '../../categories.jsx';
import { PRICING_LABELS } from '../../format.js';
import { countryName } from '../country-names.js';
import Flag from '../Flag.jsx';
import { MoreLink } from '../SeeMore.jsx';
import { CategoryTag, LinkRow, LinkRowsLoading, motion, percent, plural } from './shared.jsx';
import './country-panel.css';

export const UNKNOWN = 'unknown'; // the country filter's value for "not known yet"

const TOPICS_SHOWN = 4;
const PRICE_ORDER = ['free', 'open-source', 'freemium', 'paid', 'unknown']; // the same order as the page's price card
const PRICE_WORDS = { ...PRICING_LABELS, unknown: 'Not known' };
const TRUSTED = ['A', 'B']; // what the library's "trusted" filter counts
// The legal ending of a company's name says nothing here, and takes the room: "Apport Software Solutions Private Limited".
const LEGAL_ENDING = /[,\s]+(private limited|pvt\.? ?ltd\.?|pte\.? ?ltd\.?|pty\.? ?ltd\.?|ltd\.?|limited|llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|gmbh|ag|s\.?a\.?s?\.?|b\.?v\.?|oy|ab|plc|pbc|co\.?)$/i;
const shortCompany = name => name.replace(LEGAL_ENDING, '').replace(LEGAL_ENDING, '').trim() || name;

function Section({ title, children }) {
  return (
    <section className="cp-section">
      <h5 className="cp-title">{title}</h5>
      {children}
    </section>
  );
}

// The top topics as small colored bars. A click shows those links in the library, only from this country.
function Topics({ categories, count, code, onShow }) {
  const top = categories[0]?.count ?? 1;
  const others = categories.length - TOPICS_SHOWN;
  return (
    <Section title="What’s from here">
      <ul className="cp-topics">
        {categories.slice(0, TOPICS_SHOWN).map(({ value, count: links }) => {
          const { Icon, short } = categoryStyle(value);
          return (
            <li key={value} style={hueOf(value)}>
              <button
                type="button"
                className="cp-topic"
                onClick={() => onShow({ category: value, country: code })}
                aria-label={`${value}: ${plural(links, 'link')}. Show them in the library`}
                title={`${value} · ${percent(links, count)} of these`}
              >
                <Icon size={14} aria-hidden="true" className="cp-topic-icon" />
                <span className="cp-topic-name">{short}</span>
                <span className="cp-topic-count">{links.toLocaleString()}</span>
                <span className="cp-topic-track" aria-hidden="true">
                  <span style={{ width: `${(links / top) * 100}%` }} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {others > 0 ? <p className="cp-quiet">and {plural(others, 'more topic')}</p> : null}
    </Section>
  );
}

// One slim bar split by price, with the words under it.
function Prices({ pricing, count }) {
  const parts = PRICE_ORDER.map(value => ({ value, count: pricing.find(item => item.value === value)?.count ?? 0 })).filter(part => part.count);
  return (
    <Section title="Price">
      <div className="cp-price-bar" role="img" aria-label={parts.map(part => `${PRICE_WORDS[part.value]}: ${part.count}`).join(', ')}>
        {parts.map(part => (
          <span key={part.value} className={`cp-price-part is-${part.value}`} style={{ flexGrow: part.count }} title={`${PRICE_WORDS[part.value]}: ${plural(part.count, 'link')} (${percent(part.count, count)})`} />
        ))}
      </div>
      <ul className="cp-price-words">
        {parts.map(part => (
          <li key={part.value}>
            <i className={`cp-price-dot is-${part.value}`} aria-hidden="true" />
            {PRICE_WORDS[part.value]}
            <strong>{part.count.toLocaleString()}</strong>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Companies({ companies, total }) {
  const others = total - companies.length;
  return (
    <Section title="Companies">
      <ul className="cp-companies">
        {companies.map(({ name, count }) => (
          <li key={name} title={`${name} · ${plural(count, 'link')}`}>
            <span className="cp-company-name">{shortCompany(name)}</span>
            {count > 1 ? <span className="cp-company-count">{count.toLocaleString()}</span> : null}
          </li>
        ))}
        {others > 0 ? <li className="cp-company-more">+{others.toLocaleString()} more</li> : null}
      </ul>
    </Section>
  );
}

// Opened, favorites and trust: one quiet line.
function QuietFacts({ opened, favorites, trust }) {
  const trusted = trust.filter(({ grade }) => TRUSTED.includes(grade)).reduce((sum, { count }) => sum + count, 0);
  return (
    <ul className="cp-facts">
      <li>
        <ExternalLink size={14} aria-hidden="true" />
        <strong>{opened.toLocaleString()}</strong> opened
      </li>
      <li>
        <Star size={14} aria-hidden="true" />
        <strong>{favorites.toLocaleString()}</strong> {favorites === 1 ? 'favorite' : 'favorites'}
      </li>
      {trust.length ? (
        <li title="How many have a trust grade of A or B, from the facts the robot collected">
          <ShieldCheck size={14} aria-hidden="true" />
          <strong>{trusted.toLocaleString()}</strong> trusted
        </li>
      ) : null}
    </ul>
  );
}

// Grey shapes of about the same size as the sections, while they load.
function Loading({ count }) {
  return (
    <div className="cp-loading" aria-hidden="true">
      <div className="cp-section">
        <span className="stats-bone cp-bone-title" />
        {[0, 1, 2, 3].map(i => (
          <span key={i} className="stats-bone cp-bone-topic" style={{ width: `${92 - i * 14}%` }} />
        ))}
      </div>
      <div className="cp-section">
        <span className="stats-bone cp-bone-title" />
        <span className="stats-bone cp-bone-bar" />
        <span className="stats-bone is-thin" style={{ width: '70%' }} />
      </div>
      <div className="cp-section">
        <span className="stats-bone cp-bone-title" />
        <LinkRowsLoading count={Math.min(4, Math.max(1, count))} />
      </div>
    </div>
  );
}

export function CountryPanel({ code, count, rank, countries, links, onClose, onShow, onOpenLink }) {
  const head = useRef(null);
  const panel = useRef(null);
  const unknown = code === UNKNOWN;
  const name = unknown ? 'Not known yet' : countryName(code);
  const details = useQuery({
    queryKey: ['stats-country', code],
    queryFn: ({ signal }) => api(`/stats/country/${code}`, { signal }),
    staleTime: 60_000,
  });
  const info = details.data;
  const total = info?.count ?? count;

  // A new country: its name gets the focus (screen readers say where you are). On a wide card the panel only needs to
  // be in sight. Under the globe (a phone) it can be taller than the screen, so the page scrolls to its name.
  useEffect(() => {
    const box = panel.current;
    head.current?.focus({ preventScroll: true });
    if (box) box.scrollIntoView({ block: getComputedStyle(box).position === 'absolute' ? 'nearest' : 'start', behavior: motion() });
  }, [code]);

  // Esc closes it from anywhere on the card, like after dragging the globe, but not from a window opened on top of it.
  useEffect(() => {
    const onKey = event => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const at = document.activeElement;
      if (at && at !== document.body && !at.closest('#stats-where')) return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const line = [plural(total, 'link'), !unknown && rank ? `#${rank} of ${countries}` : null, `${percent(total, links)} of your library`].filter(Boolean).join(' · ');

  return (
    <div
      ref={panel}
      className="where-panel"
      role="region"
      aria-labelledby="stats-where-panel-title"
    >
      <div className="cp-body">
        <header className="cp-head">
          <span className={`cp-flag${unknown ? ' is-unknown' : ''}`} aria-hidden="true">
            {unknown ? <CircleHelp size={26} /> : <Flag code={code} />}
          </span>
          <div className="cp-names">
            <h4 id="stats-where-panel-title" ref={head} tabIndex={-1}>
              {name}
            </h4>
            <p>{line}</p>
          </div>
          <button type="button" className="icon-btn icon-btn-sm cp-close" onClick={onClose} aria-label="Close" title="Close">
            <X size={18} />
          </button>
        </header>
        {unknown ? (
          <p className="cp-why">
            The robot hasn’t worked out yet where the company behind these links is. It keeps reading their Terms pages and
            Wikidata, and they move to their country as it learns.
          </p>
        ) : null}
        {details.isError ? (
          <div className="stats-calm cp-section">
            <span>The details didn’t load. {details.error.message}</span>
            <button type="button" className="btn btn-ghost" onClick={() => details.refetch()}>
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
          </div>
        ) : details.isPending ? (
          <Loading count={count} />
        ) : info.count ? (
          <>
            <Topics categories={info.categories} count={info.count} code={code} onShow={onShow} />
            <Prices pricing={info.pricing} count={info.count} />
            {info.companies.length ? <Companies companies={info.companies} total={info.companiesTotal} /> : null}
            <QuietFacts opened={info.opened} favorites={info.favorites} trust={info.trust} />
            <Section title="Links">
              <ul className="stats-links cp-links" aria-label={`Links from ${name}`}>
                {info.links.map(link => (
                  <LinkRow key={link.id} link={link} side={<CategoryTag name={link.category} />} onOpenLink={onOpenLink} />
                ))}
              </ul>
            </Section>
          </>
        ) : (
          <p className="stats-calm cp-section">No links here any more.</p>
        )}
      </div>
      <div className="cp-foot">
        <MoreLink onClick={() => onShow({ country: code })} className="cp-all">
          {total === 1 ? 'Show it in the library' : `Show all ${total.toLocaleString()} in the library`}
        </MoreLink>
      </div>
    </div>
  );
}
