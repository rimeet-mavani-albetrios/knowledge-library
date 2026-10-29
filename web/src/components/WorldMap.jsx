// A world map that colors each country by a number: the more, the darker the teal ("links per country").
// `values` is { US: 12, DE: 3 } (two-letter country codes), `label` names the map for screen readers, `onPick(code)`
// (optional) makes the colored countries clickable, `format(n)` (optional) is the number's words in the label that
// follows the mouse ("12 links"), and `legend={false}` hides the key to the shades. Countries too small for the map
// (Singapore, Hong Kong…) show as a dot. The country shapes (about 100 KB) load the first time a map is shown, so the
// rest of the site stays fast.
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countryFlag, countryName } from './country-names.js';
import './worldmap.css';

const STEPS = 5; // shades of teal

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

// The shapes, drawn once per set of values: moving the mouse only moves the label, it doesn't draw the map again.
const Shapes = memo(function Shapes({ data, shades, values, clickable }) {
  const focusable = code => clickable && shades.has(code);
  const name = code => `${countryName(code)}: ${values[code].toLocaleString()}`;
  return (
    <>
      {data.shapes.map(({ code, d }, i) => (
        <path
          key={`${code}-${i}`}
          d={d}
          data-code={code}
          className={`wm-land wm-s${shades.get(code) ?? 0}`}
          tabIndex={focusable(code) ? 0 : undefined}
          role={focusable(code) ? 'button' : undefined}
          aria-label={shades.has(code) ? name(code) : undefined}
        />
      ))}
      {data.dots
        .filter(dot => shades.has(dot.code))
        .map(({ code, x, y }) => (
          <circle
            key={code}
            cx={x}
            cy={y}
            r={4.5}
            data-code={code}
            className={`wm-dot wm-s${shades.get(code)}`}
            tabIndex={clickable ? 0 : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={name(code)}
          />
        ))}
    </>
  );
});

export default function WorldMap({ values = {}, onPick, label = 'World map', format, legend = true, className = '' }) {
  const [data, setData] = useState(loaded);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState(null); // { code, x, y } for the label, in pixels inside the map
  const box = useRef(null);
  const { shades, max } = useMemo(() => shadesFor(values), [values]);
  const words = format ?? (n => n.toLocaleString());

  useEffect(() => {
    if (!data) loadShapes().then(setData, () => setFailed(true));
  }, [data]);

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
          <Shapes data={data} shades={shades} values={values} clickable={clickable} />
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
            {countryFlag(hovered)} {countryName(hovered)}
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
