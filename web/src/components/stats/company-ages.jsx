// "Lineage": how old the companies behind your links are, from the year Wikidata says each one was founded.
// Two tiles, the oldest company and the newest (with the next two of each under them), then a small bar per decade.
// Click a company to open the link it came from.
// Only shown when at least one founding year is known: StatsPage leaves the card out otherwise.
import { Card, plural } from './shared.jsx';
import './company-ages.css';

const DECADES_SHOWN = 7; // older decades than these share one "Older" bar, so the bars stay wide enough to read

// The decade bars: the last DECADES_SHOWN decades, empty ones included, and "Older" for everything before.
function decadeBars(decades) {
  if (!decades.length) return [];
  const last = decades[decades.length - 1].decade;
  const first = Math.max(decades[0].decade, last - (DECADES_SHOWN - 1) * 10);
  const older = decades.filter(row => row.decade < first).reduce((sum, row) => sum + row.count, 0);
  const bars = older ? [{ key: 'older', label: 'Older', title: `Before ${first}`, count: older }] : [];
  for (let decade = first; decade <= last; decade += 10) {
    const count = decades.find(row => row.decade === decade)?.count ?? 0;
    bars.push({ key: decade, label: `${String(decade).slice(2)}s`, title: `${decade}s`, count });
  }
  return bars;
}

const ageText = (founded, year) => (year > founded ? `${plural(year - founded, 'year')} old` : 'Founded this year');

// One tile: the first company big, the others as small rows under it.
function AgeTile({ label, tone, list, year, onOpenLink }) {
  const [first, ...more] = list;
  const via = company => (company.link.title && company.link.title !== company.name ? `, from “${company.link.title}”` : '');
  return (
    <div className={`ages-tile is-${tone}`}>
      <button
        type="button"
        className="ages-main"
        onClick={() => onOpenLink(first.link.id)}
        aria-label={`${label}: ${first.name}, founded ${first.year}${via(first)}. Open the link`}
      >
        <span className="ages-label">{label}</span>
        <span className="ages-year">{first.year}</span>
        <span className="ages-name">{first.name}</span>
        <span className="ages-sub">{ageText(first.year, year)}</span>
      </button>
      {more.length ? (
        <ul className="ages-more">
          {more.map(company => (
            <li key={company.link.id}>
              <button
                type="button"
                className="ages-more-row"
                onClick={() => onOpenLink(company.link.id)}
                aria-label={`${company.name}, founded ${company.year}${via(company)}. Open the link`}
              >
                <span className="ages-more-year">{company.year}</span>
                <span className="ages-more-name">{company.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function CompanyAges({ companies, plate, onOpenLink }) {
  const year = new Date().getFullYear();
  // With only a few companies, the oldest and newest lists would repeat each other: each company shows once.
  const oldIds = new Set(companies.oldest.map(company => company.link.id));
  const newest = companies.newest.filter(company => !oldIds.has(company.link.id));
  const bars = decadeBars(companies.decades);
  const most = Math.max(1, ...bars.map(bar => bar.count));

  return (
    <Card
      id="stats-ages"
      plate={plate}
      kicker="Lineage"
      title="How old the companies are"
      sub={`When the companies behind your links were founded (Wikidata). ${plural(companies.total, 'company', 'companies')} known.`}
      className="stats-ages"
    >
      <div className={`ages-pair${newest.length ? '' : ' is-single'}`}>
        <AgeTile label="Oldest" tone="old" list={companies.oldest} year={year} onOpenLink={onOpenLink} />
        {newest.length ? <AgeTile label="Newest" tone="new" list={newest} year={year} onOpenLink={onOpenLink} /> : null}
      </div>
      {bars.length > 1 ? (
        <div className="ages-decades">
          <h4 className="stats-mini-title">Founded per decade</h4>
          <ol className="ages-bars" aria-label="Companies founded per decade">
            {bars.map(bar => (
              <li key={bar.key} title={`${bar.title}: ${plural(bar.count, 'company', 'companies')}`}>
                <span className="ages-bar-count" aria-hidden="true">
                  {bar.count || ''}
                </span>
                <span className="ages-bar" aria-hidden="true">
                  <span style={{ height: bar.count ? `${Math.max(4, (bar.count / most) * 100)}%` : 0 }} />
                </span>
                <span className="ages-bar-label">{bar.label}</span>
                <span className="sr-only">: {plural(bar.count, 'company', 'companies')}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Card>
  );
}
