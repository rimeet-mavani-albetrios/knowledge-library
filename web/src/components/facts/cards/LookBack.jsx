// Look back: how the home page looked in earlier years, from the Internet Archive's copies (one per year).
// Slide to a year; the old page shows in a small window, and "Open this version" opens it full size.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { History, ExternalLink, LoaderCircle } from 'lucide-react';
import { fullDate } from '../../../format.js';

export const tab = 'history';
export const order = 10;

const PAGE_WIDTH = 1280; // the old page is drawn at this width and shrunk to fit
const SETTLE_MS = 300; // wait while the slider moves, so only the year you stop on loads

const archiveDate = timestamp => `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;

export default function LookBack({ facts }) {
  const archive = facts.archive;
  const years = archive?.years ?? [];
  const [index, setIndex] = useState(0); // the oldest year first: that's the point of looking back
  const [shown, setShown] = useState(0); // the year in the window (follows the slider after it settles)
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(0.5);
  const frameRef = useRef(null);

  useEffect(() => {
    if (index === shown) return undefined;
    const timer = setTimeout(() => {
      setShown(index);
      setLoading(true);
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [index, shown]);

  // The old page keeps its desktop layout, shrunk to the width of the card.
  useLayoutEffect(() => {
    const box = frameRef.current;
    if (!box) return undefined;
    const fit = () => setScale(box.clientWidth / PAGE_WIDTH);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [years.length]);

  if (!years.length) return null;
  const pick = years[Math.min(index, years.length - 1)];
  const page = years[Math.min(shown, years.length - 1)];
  const frameUrl = `https://web.archive.org/web/${page.timestamp}if_/${archive.url}`;
  const openUrl = `https://web.archive.org/web/${pick.timestamp}/${archive.url}`;
  const yearsAgo = new Date().getFullYear() - pick.year;

  return (
    <section className="fact-card look-back">
      <div className="look-head">
        <h3 className="fact-card-title">
          <History size={14} aria-hidden="true" /> Look back
        </h3>
        <a className="btn btn-ghost fact-btn" href={openUrl} target="_blank" rel="noopener noreferrer">
          Open this version <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
      <p className="look-year">
        <strong>{pick.year}</strong>
        <span className="fact-muted">
          {yearsAgo > 0 ? ` · ${yearsAgo} ${yearsAgo === 1 ? 'year' : 'years'} ago` : ' · this year'} · saved {fullDate(archiveDate(pick.timestamp))}
        </span>
      </p>
      {years.length > 1 ? (
        <div className={`look-slider${years.length > 9 ? ' is-dense' : ''}`}>
          <input
            type="range"
            min={0}
            max={years.length - 1}
            step={1}
            value={index}
            aria-label="Year"
            aria-valuetext={String(pick.year)}
            onChange={event => setIndex(Number(event.target.value))}
          />
          <div className="look-ticks" aria-hidden="true">
            {years.map((item, i) => (
              <button
                key={item.timestamp}
                type="button"
                tabIndex={-1}
                className={`${i === index ? 'is-on' : ''}${i === 0 || i === years.length - 1 ? ' is-end' : ''}`}
                style={{ '--at': i / (years.length - 1) }}
                onClick={() => setIndex(i)}
              >
                <span>{item.year}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="look-frame" ref={frameRef}>
        <iframe
          key={frameUrl}
          src={frameUrl}
          title={`The home page in ${page.year}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-same-origin"
          style={{ width: PAGE_WIDTH, height: `${100 / scale}%`, transform: `scale(${scale})` }}
          onLoad={() => setLoading(false)}
        />
        {loading ? (
          <span className="look-loading">
            <LoaderCircle size={18} className="spin" aria-hidden="true" /> Loading the {page.year} page…
          </span>
        ) : null}
      </div>
      <p className="fact-source">From the Internet Archive’s Wayback Machine. Some old pages show without their pictures or styles.</p>
    </section>
  );
}
