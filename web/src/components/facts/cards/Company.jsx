// Who runs the website: the company from its own Privacy or Terms page (read by the free AI), plus when it was
// founded, by whom and where, from Wikidata.
import { Building2, MapPin, ExternalLink } from 'lucide-react';
import { countryName, flag } from '../places.js';

export const tab = 'company';
export const order = 10;

const place = (city, country) => [city, countryName(country)].filter(Boolean).join(', ');

export function glance(facts) {
  const country = facts.company?.country || facts.wikidata?.country;
  if (!country) return null;
  return { icon: MapPin, text: `${flag(country)} ${countryName(country, { short: true })}`.trim(), tab: 'company' };
}

export default function Company({ facts }) {
  const company = facts.company ?? {};
  const wiki = facts.wikidata ?? {};
  const name = company.name || wiki.name;
  const country = company.country || wiki.country;
  const city = company.city || wiki.city;
  const policy = company.policy ?? {};
  const rows = [
    name && ['Company', name],
    (city || country) && ['Based in', `${flag(country)} ${place(city, country)}`.trim()],
    wiki.founded && ['Founded', String(wiki.founded)],
    wiki.founders?.length && ['Founders', wiki.founders.join(', ')],
    company.dataRegion && ['Your data is kept in', `${flag(company.dataRegion)} ${countryName(company.dataRegion)}`.trim()],
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

