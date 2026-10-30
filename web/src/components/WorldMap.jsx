// A world map that colors each country by a number: the more, the darker the teal ("links per country").
// `values` is { US: 12, DE: 3 } (two-letter country codes), `label` names the map for screen readers, `onPick(code)`
// (optional) makes the colored countries clickable, `format(n)` (optional) is the number's words in the label that
// follows the mouse ("12 links"), `selected` (optional, a code) outlines that country, and `legend={false}` hides the
// key to the shades. Countries too small to see or click (Singapore, Bahrain, the UAE, Belgium…) get a round bubble,
// a little bigger for bigger numbers. The country shapes (about 100 KB) load the first time a map is shown, so the
// rest of the site stays fast.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countryFlag, countryName } from './country-names.js';
import Flag from './Flag.jsx';
import './worldmap.css';

const STEPS = 5; // shades of teal
// Bubble sizes on the screen, in pixels, on a map at least FULL_SIZE_AT wide. On narrower maps (phones) they shrink a
// little, down to about half, so they don't cover the colored countries of Europe.
const BUBBLE_SMALLEST = 4.5;
const BUBBLE_BIGGEST = 8;
const BUBBLE_GAP = 1.5; // space kept between two bubbles
const FULL_SIZE_AT = 760;
const SMALLEST_SIZE = 0.55;

let loaded = null; // the shapes, once they are here
let loading = null;
function loadShapes() {
  loading ??= import('./world-shapes.js').then(module => {
    loaded = { ...module.worldShapes(), width: module.WIDTH, height: module.HEIGHT };
    return loaded;
  });
  return loading;
}

export { countryFlag, countryName };

// Each country's shade, 1 (a little) to 5 (the most). The numbers often run from 1 to a few hundred, so the shades
// follow their size in steps of "times as many" (1, 3, 10, 30…): otherwise one big country would make all others pale.
function shadesFor(values) {
  const max = Math.max(0, ...Object.values(values).filter(Number.isFinite));
  const shades = new Map();
  for (const [code, value] of Object.entries(values)) {
    if (!(value > 0)) continue;
    const share = max > 1 ? Math.log(value) / Math.log(max) : 1;
    shades.set(code, 1 + Math.round(Math.max(0, Math.min(1, share)) * (STEPS - 1)));
  }
  return { shades, max };
}

// The bubbles of the countries that have a number, in the map's own units (`scale`: map units per screen pixel).
// The biggest go first; one that would cover another is pushed aside a little and keeps a thin line back to its
// country, so the many small countries of Europe stay apart and each one can be pointed at.
function bubblesFor(dots, shades, scale, width, height) {
  const placed = [];
  const list = dots
    .filter(dot => shades.has(dot.code))
    .map(dot => {
      const shade = shades.get(dot.code);
      return { ...dot, shade, r: (BUBBLE_SMALLEST + ((BUBBLE_BIGGEST - BUBBLE_SMALLEST) * (shade - 1)) / (STEPS - 1)) * scale };
    })
    .sort((a, b) => b.r - a.r || a.code.localeCompare(b.code));
  const gap = BUBBLE_GAP * scale;
  for (const dot of list) {
    let { x, y } = dot;
    for (let step = 0; step < 40; step++) {
      const other = placed.find(item => Math.hypot(item.x - x, item.y - y) < item.r + dot.r + gap);
      if (!other) break;
      const dx = x - other.x;
      const dy = y - other.y;
      const apart = Math.hypot(dx, dy);
      // Right on top of each other: move down and to the right.
      const [ux, uy] = apart > 0.01 ? [dx / apart, dy / apart] : [0.6, 0.8];
      const push = other.r + dot.r + gap - apart + 0.1;
      x = Math.min(width - dot.r, Math.max(dot.r, x + ux * push));
      y = Math.min(height - dot.r, Math.max(dot.r, y + uy * push));
    }
    placed.push({ ...dot, homeX: dot.x, homeY: dot.y, x, y, moved: Math.hypot(x - dot.x, y - dot.y) > dot.r * 0.6 });
  }
  return placed;
}

// The shapes, drawn once per set of values: moving the mouse only moves the label, it doesn't draw the map again.
// A country with a bubble is reached with the keyboard through its bubble, so its shape is not a stop of its own.
const Shapes = memo(function Shapes({ data, shades, values, clickable, bubbled, selected }) {
  const focusable = code => clickable && shades.has(code) && !bubbled.has(code);
  const name = code => `${countryName(code)}: ${values[code].toLocaleString()}`;
  return data.shapes.map(({ code, d }, i) => (
    <path
      key={`${code}-${i}`}
      d={d}
      data-code={code}
      className={`wm-land wm-s${shades.get(code) ?? 0}`}
      tabIndex={focusable(code) ? 0 : undefined}
      role={focusable(code) ? 'button' : undefined}
      aria-pressed={focusable(code) && selected !== undefined ? code === selected : undefined}
      aria-label={focusable(code) || (!clickable && shades.has(code) && !bubbled.has(code)) ? name(code) : undefined}
    />
  ));
});

export default function WorldMap({ values = {}, onPick, label = 'World map', format, legend = true, selected, className = '' }) {
  const [data, setData] = useState(loaded);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(null); // { code, x, y } for the label, in pixels inside the map
  const [boxWidth, setBoxWidth] = useState(0);
  const box = useRef(null);
  const { shades, max } = useMemo(() => shadesFor(values), [values]);
  const words = format ?? (n => n.toLocaleString());

  useEffect(() => {
    if (!data) loadShapes().then(setData, () => setFailed(true));
  }, [data]);

  // The map's width on the screen, so the bubbles keep the same size in pixels however wide the map is.
  useEffect(() => {
    const node = box.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Map units per screen pixel, times the shrinking on narrow maps.
  const size = boxWidth ? Math.min(1, Math.max(SMALLEST_SIZE, boxWidth / FULL_SIZE_AT)) : 1;
  const scale = data && boxWidth ? Math.round(((data.width / boxWidth) * size) * 100) / 100 : 1;
  const bubbles = useMemo(
    () => (data ? bubblesFor(data.dots, shades, scale, data.width, data.height) : []),
    [data, shades, scale],
  );
  const bubbled = useMemo(() => new Set(bubbles.map(bubble => bubble.code)), [bubbles]);

  const codeOf = target => target?.closest?.('[data-code]')?.dataset.code ?? '';
  const show = useCallback((code, x, y) => setHover(code ? { code, x, y } : null), []);
  const onMove = event => {
    const code = codeOf(event.target);
    const rect = box.current.getBoundingClientRect();
    show(code, event.clientX - rect.left, event.clientY - rect.top);
  };
  // The keyboard: the label sits over the country that has the focus.
  const onFocus = event => {
    const code = codeOf(event.target);
    const rect = box.current.getBoundingClientRect();
    const place = event.target.getBoundingClientRect();
    show(code, place.left + place.width / 2 - rect.left, place.top + place.height / 2 - rect.top);
  };
  const pick = event => {
    const code = codeOf(event.target);
    if (code && onPick && shades.has(code)) onPick(code);
  };

  const hovered = hover?.code;
  const clickable = Boolean(onPick);
  const name = code => `${countryName(code)}: ${values[code].toLocaleString()}`;
  return (
    <div
      ref={box}
      className={`world-map${clickable ? ' is-clickable' : ''}${data ? '' : ' is-loading'} ${className}`}
      role="group"
      aria-label={label}
    >
      {data ? (
        <svg
          viewBox={`0 0 ${data.width} ${data.height}`}
          className="wm-svg"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={onFocus}
          onBlur={() => setHover(null)}
          onClick={pick}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              pick(event);
            }
          }}
        >
          <Shapes data={data} shades={shades} values={values} clickable={clickable} bubbled={bubbled} selected={selected} />
          {selected
            ? data.shapes
                .filter(shape => shape.code === selected)
                .map(({ d }, i) => <path key={`picked-${i}`} d={d} className="wm-picked" aria-hidden="true" />)
            : null}
          {bubbles
            .filter(bubble => bubble.moved)
            .map(({ code, x, y, homeX, homeY }) => (
              <line key={`line-${code}`} x1={homeX} y1={homeY} x2={x} y2={y} className="wm-leader" aria-hidden="true" />
            ))}
          {bubbles.map(({ code, x, y, r, shade }) => (
            <circle
              key={code}
              cx={x}
              cy={y}
              r={r}
              data-code={code}
              className={`wm-dot wm-s${shade}${code === selected ? ' is-picked' : ''}`}
              tabIndex={clickable ? 0 : undefined}
              role={clickable ? 'button' : 'img'}
              aria-pressed={clickable && selected !== undefined ? code === selected : undefined}
              aria-label={name(code)}
            />
          ))}
        </svg>
      ) : (
        <div className="wm-placeholder">{failed ? 'The map could not load. Check your internet connection.' : null}</div>
      )}
      {hovered ? (
        <div
          className={`wm-tip${hover.x > (box.current?.clientWidth ?? 0) - 160 ? ' is-left' : ''}`}
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          <span className="wm-tip-name">
            <Flag code={hovered} /> {countryName(hovered)}
          </span>
          <span className="wm-tip-value">{values[hovered] > 0 ? words(values[hovered]) : words(0)}</span>
        </div>
      ) : null}
      {legend && max > 0 ? (
        <div className="wm-legend" aria-hidden="true">
          <span>{words(1)}</span>
          {Array.from({ length: STEPS }, (_, i) => (
            <i key={i} className={`wm-swatch wm-s${i + 1}`} />
          ))}
          <span>{max > 1 ? words(max) : ''}</span>
        </div>
      ) : null}
    </div>
  );
}
