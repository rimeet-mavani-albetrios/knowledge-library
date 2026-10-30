// Who runs the website: the company from its own Privacy or Terms page (read by the free AI), plus when it was
// founded, by whom and where, from Wikidata. The country is the link's one country (the `place` fact, the same one
// the filter and the world map use); when it was borrowed or guessed, a quiet note says from where.
import { Building2, MapPin, ExternalLink } from 'lucide-react';
import Flag from '../../Flag.jsx';
import { countryName, countryOf, countrySource } from '../places.js';
import './company.css';

export const tab = 'company';
export const order = 10;

// Sources the card's last line already names ("From the website's own legal pages and Wikidata").
const NAMED_BELOW = new Set(['company', 'wikidata']);

export function glance(facts) {
  const country = countryOf(facts);
  if (!country) return null;
  return {
    icon: MapPin,
    label: 'Country',
    value: (
      <>
        <Flag code={country} /> {countryName(country, { short: true })}
      </>
    ),
    rank: 40,
    tab: 'company',
  };
}

export default function Company({ facts }) {
  const company = facts.company ?? {};
  const wiki = facts.wikidata ?? {};
  const name = company.name || wiki.name;
  const country = countryOf(facts);
  // A city only goes with the country it was found with (amazon.in's legal page names Bengaluru, but the link's
  // country is Amazon's own).
  const sameCountry = code => !code || String(code).toUpperCase() === country;
  const city = (sameCountry(company.country) && company.city) || (sameCountry(wiki.country) && wiki.city) || '';
  const note = NAMED_BELOW.has(facts.place?.source) ? '' : countrySource(facts.place);
  const policy = company.policy ?? {};
  const rows = [
    name && ['Company', name],
    (city || country) && [
      'Based in',
      <>
        <Flag code={country} /> {[city, countryName(country)].filter(Boolean).join(', ')}
        {note ? <span className="fact-where-from"> · {note}</span> : null}
      </>,
    ],
    wiki.founded && ['Founded', String(wiki.founded)],
    wiki.founders?.length && ['Founders', wiki.founders.join(', ')],
    company.dataRegion && [
      'Your data is kept in',
      <>
        <Flag code={company.dataRegion} /> {countryName(company.dataRegion)}
      </>,
    ],
  ].filter(Boolean);
  const pages = [policy.privacy && ['Privacy policy', policy.privacy], policy.terms && policy.terms !== policy.privacy && ['Terms', policy.terms]].filter(Boolean);
  if (!rows.length && !pages.length) return null;

  const sources = [company.source === 'terms' && 'the website’s own legal pages', wiki.id && 'Wikidata'].filter(Boolean);
  return (
    <section className="fact-card">
      <h3 className="fact-card-title">
        <Building2 size={14} aria-hidden="true" /> Who runs it
      </h3>
      {rows.length ? (
        <dl className="fact-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="fact-muted">The website doesn’t say clearly who runs it.</p>
      )}
      {pages.length || wiki.url ? (
        <div className="fact-links">
          {pages.map(([label, url]) => (
            <a key={label} href={url} target="_blank" rel="noopener noreferrer">
              {label} <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
          {wiki.url ? (
            <a href={wiki.url} target="_blank" rel="noopener noreferrer">
              Wikidata <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}
      {sources.length ? <p className="fact-source">From {sources.join(' and ')}.</p> : null}
    </section>
  );
}
