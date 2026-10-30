// "Where your tools come from": a 3D Earth (globe.jsx), its countries colored and raised by how many of your links
// have their company there, and all the countries in a list beside it, with a box to find one. The list scrolls inside
// itself, so the card keeps one height next to the globe. Clicking a country (on the globe or in the list) flies the
// globe there and opens its profile (country-panel.jsx) in the list's place; × or Esc closes it.
// In a narrow card (phones, tablets) the globe sits on top, the profile opens as a sheet under it, and the list shows
// its top rows with a "Show all" button: a list that scrolls inside a page that scrolls is hard to use with a thumb.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, CircleHelp, Earth, Search, X } from 'lucide-react';
import { countryName } from '../country-names.js';
import Flag from '../Flag.jsx';
import { Reveal, SeeMore } from '../SeeMore.jsx';
import { CountryPanel, UNKNOWN } from './country-panel.jsx';
import { EarthGlobe } from './globe.jsx';
import { cssColor, scaleColor, scaleOf } from './globe-colors.js';
import { Card, plural } from './shared.jsx';
import './where.css';

const ROWS_NARROW = 6; // rows shown before "Show all" in a narrow card
const WIDE_CARD = 820; // from this width (the card's inside) the list stands beside the globe

// Is the card's inside narrower than WIDE_CARD? The same line as the @container rule in where.css.
function useNarrow(ref) {
  const [narrow, setNarrow] = useState(true);
  useLayoutEffect(() => {
    setNarrow(ref.current.getBoundingClientRect().width < WIDE_CARD); // before the first paint, so nothing flashes
    const observer = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < WIDE_CARD));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);
  return narrow;
}

function CountryRow({ country, count, top, most, picked, onPick }) {
  const color = cssColor(scaleColor(scaleOf(count, most)));
  return (
    <li>
      <button type="button" className={`where-row${picked ? ' is-picked' : ''}`} aria-pressed={picked} onClick={() => onPick(country)}>
        <Flag code={country} className="where-flag" />
        <span className="where-row-name">{countryName(country)}</span>
        <span className="where-row-count">{count.toLocaleString()}</span>
        <span className="where-row-track" aria-hidden="true">
          {/* The square root keeps small countries visible next to one giant, and the bars still go in order. */}
          <span className="where-row-fill" style={{ width: `${Math.sqrt(count / top) * 100}%`, background: color }} />
        </span>
      </button>
    </li>
  );
}

// The list's soft edges show only where there is more to scroll to.
function useScrollEdges(ref, again) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => {
      element.dataset.top = element.scrollTop > 2 ? 'more' : '';
      element.dataset.bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 2 ? 'more' : '';
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [ref, again]);
}

export function Where({ data, plate, onShow, onOpenLink }) {
  const [picked, setPicked] = useState('');
  const [find, setFind] = useState('');
  const [all, setAll] = useState(false);
  const body = useRef(null);
  const scroller = useRef(null);
  const opener = useRef(null); // what had the focus before the panel opened, to give it back on close
  const narrow = useNarrow(body);
  const values = useMemo(() => Object.fromEntries(data.countries.map(({ country, count }) => [country, count])), [data.countries]);
  const { withFacts, unknownCountry, links } = data.totals;
  const top = data.countries[0]?.count ?? 0;
  const empty = data.countries.length === 0;
  const placed = links - unknownCountry;

  const needle = find.trim().toLowerCase();
  const found = useMemo(
    () => (needle ? data.countries.filter(({ country }) => countryName(country).toLowerCase().includes(needle) || country.toLowerCase() === needle) : data.countries),
    [data.countries, needle],
  );
  // Narrow: the top rows, and the others behind "Show all". Searching always shows every match.
  const capped = narrow && !needle;
  const first = capped ? found.slice(0, ROWS_NARROW) : found;
  const rest = capped ? found.slice(ROWS_NARROW) : [];
  useScrollEdges(scroller, `${narrow}-${found.length}`);

  const pick = code => {
    if (!picked) opener.current = document.activeElement;
    setPicked(code);
  };
  const close = () => {
    setPicked('');
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const rankOf = code => data.countries.findIndex(({ country }) => country === code) + 1;
  const row = ({ country, count }) => (
    <CountryRow key={country} country={country} count={count} top={top} most={top} picked={picked === country} onPick={pick} />
  );

  return (
    <Card
      id="stats-where"
      plate={plate}
      kicker="Origins"
      title="Where your tools come from"
      sub="The country of the company behind each website. Drag the globe to spin it, click a country to see what’s from there."
      className="stats-where"
    >
      <div ref={body} className={`where-body${picked ? ' is-open' : ''}`}>
        <div className="where-map">
          <EarthGlobe values={values} selected={picked && picked !== UNKNOWN ? picked : ''} onPick={pick} label="A globe of where the companies behind your links are" />
          {empty ? (
            <div className="where-map-note">
              <Earth size={22} aria-hidden="true" />
              <strong>{withFacts ? 'No countries found yet' : 'Countries are being found out'}</strong>
              <span>
                The robot reads each website’s Terms page and Wikidata to learn where the company is. Countries light up
                here as it goes.
              </span>
            </div>
          ) : null}
        </div>
        <div className="where-side">
          {picked ? (
            <CountryPanel
              key={picked}
              code={picked}
              count={picked === UNKNOWN ? unknownCountry : (values[picked] ?? 0)}
              rank={rankOf(picked)}
              countries={data.countries.length}
              links={links}
              onClose={close}
              onShow={onShow}
              onOpenLink={onOpenLink}
            />
          ) : null}
          <div className="where-list">
            <h4 className="stats-mini-title where-list-title">
              All countries
              {placed > 0 ? <span className="where-placed">{plural(placed, 'link')} placed</span> : null}
            </h4>
            {empty ? (
              <p className="stats-quiet">None yet.</p>
            ) : (
              <>
                <label className="where-find">
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="text"
                    value={find}
                    onChange={event => setFind(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Escape' && find) {
                        event.stopPropagation();
                        setFind('');
                      }
                    }}
                    placeholder="Find a country"
                    aria-label="Find a country"
                    autoComplete="off"
                    spellCheck="false"
                  />
                  {find ? (
                    <button type="button" className="where-find-clear" onClick={() => setFind('')} aria-label="Clear" title="Clear">
                      <X size={14} aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <div ref={scroller} className="where-scroll">
                  {found.length ? (
                    <>
                      <ol className="where-rows" aria-label="Countries with the most links first">
                        {first.map(row)}
                      </ol>
                      {rest.length ? (
                        <>
                          <Reveal open={all} id="stats-where-rest">
                            <ol className="where-rows" aria-label="More countries" start={ROWS_NARROW + 1}>
                              {rest.map(row)}
                            </ol>
                          </Reveal>
                          <SeeMore
                            open={all}
                            more={`Show all ${data.countries.length} countries`}
                            less="Show fewer"
                            controls="stats-where-rest"
                            onClick={() => setAll(!all)}
                            className="where-more"
                          />
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="where-none">No country called “{find.trim()}” here.</p>
                  )}
                </div>
              </>
            )}
            {unknownCountry > 0 ? (
              <button
                type="button"
                className={`where-unknown${picked === UNKNOWN ? ' is-picked' : ''}`}
                aria-pressed={picked === UNKNOWN}
                onClick={() => pick(UNKNOWN)}
              >
                <CircleHelp size={16} aria-hidden="true" />
                <span className="where-unknown-name">Not known yet</span>
                <span className="where-row-count">{plural(unknownCountry, 'link')}</span>
                <ChevronRight size={15} aria-hidden="true" className="where-unknown-go" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
