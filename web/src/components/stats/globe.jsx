// The Earth on the "Origins" card: the React side of it. It holds the place (a softly shaded circle of the same size,
// so nothing on the page jumps), loads the 3D part (globe-scene.js, about 1 MB) only when the card comes near the
// screen, stops drawing when the card is off-screen or the tab is hidden, and has the + − and reset buttons and the
// label that follows the mouse. On a computer that can't draw 3D it quietly shows the flat WorldMap instead.
// (Only a named export here: a file in this folder with a default export becomes an extra card, see StatsPage.jsx.)
import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import WorldMap from '../WorldMap.jsx';
import { countryName } from '../country-names.js';
import Flag from '../Flag.jsx';
import { SCALE_GRADIENT } from './globe-colors.js';
import { plural } from './shared.jsx';
import './globe.css';

const isDark = () => document.documentElement.dataset.theme === 'dark';
const wantsCalm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Can this computer draw 3D at all? Checked once: every check makes a drawing surface, and browsers allow only a few.
let canDraw = null;
function draws3d() {
  if (canDraw !== null) return canDraw;
  try {
    const test = document.createElement('canvas');
    canDraw = Boolean(test.getContext('webgl2') ?? test.getContext('webgl'));
  } catch {
    canDraw = false;
  }
  return canDraw;
}

export function EarthGlobe({ values, selected, onPick, label }) {
  const [flat, setFlat] = useState(() => !draws3d());
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState('');
  const box = useRef(null);
  const stage = useRef(null);
  const tip = useRef(null);
  const earth = useRef(null);
  const latest = useRef({ values, onPick, selected });
  latest.current = { values, onPick, selected };

  // Only when the card comes near the screen: most visits to the page never scroll this far right away.
  useEffect(() => {
    if (flat || near) return undefined;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: '700px 0px' });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [flat, near]);

  // Make the globe. React's StrictMode runs this twice in development, so a slow first run must not leave one behind.
  useEffect(() => {
    if (flat || !near) return undefined;
    let gone = false;
    let made = null;
    const fail = () => {
      if (!gone) setFlat(true);
    };
    const element = stage.current;
    const { width, height } = element.getBoundingClientRect();
    import('./globe-scene.js')
      .then(({ createEarth }) =>
        createEarth(element, {
          width,
          height,
          values: latest.current.values,
          dark: isDark(),
          calm: wantsCalm(),
          onHover: code => setHover(code ?? ''),
          onMove: (x, y) => {
            if (tip.current) tip.current.style.transform = `translate(${x}px, ${y}px)`;
          },
          onPick: code => latest.current.onPick?.(code),
          onReady: () => {
            if (!gone) setReady(true);
          },
        }),
      )
      .then(scene => {
        if (gone) {
          scene.destroy();
          return;
        }
        made = scene;
        earth.current = scene;
        scene.setSelected(latest.current.selected);
      })
      .catch(fail);
    // The graphics card can give up later too (a driver crash, too many open pages).
    const onLost = () => fail();
    element.addEventListener('webglcontextlost', onLost, true);
    return () => {
      gone = true;
      element.removeEventListener('webglcontextlost', onLost, true);
      earth.current = null;
      made?.destroy();
    };
  }, [flat, near]);

  // What the page tells the globe: the numbers (when they change) and the picked country.
  const shown = useRef(values);
  useEffect(() => {
    if (!ready || shown.current === values) return;
    shown.current = values;
    earth.current?.setValues(values);
  }, [values, ready]);
  useEffect(() => {
    if (ready) earth.current?.setSelected(selected);
  }, [selected, ready]);

  // Stop drawing while nobody can see it (off-screen, or another tab), and follow the card's size and the theme.
  useEffect(() => {
    if (flat || !ready) return undefined;
    let visible = true;
    const update = () => {
      if (visible && !document.hidden) earth.current?.resume();
      else earth.current?.pause();
    };
    const seen = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        update();
      },
      { rootMargin: '80px 0px' },
    );
    seen.observe(box.current);
    document.addEventListener('visibilitychange', update);
    const sized = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      earth.current?.resize(width, height);
    });
    sized.observe(stage.current);
    const theme = new MutationObserver(() => earth.current?.setTheme(isDark()));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      seen.disconnect();
      sized.disconnect();
      theme.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [flat, ready]);

  if (flat) {
    return <WorldMap values={values} selected={selected || undefined} onPick={onPick} label={label} format={n => (n ? plural(n, 'link') : 'No links')} />;
  }

  const most = Math.max(0, ...Object.values(values));
  return (
    <div ref={box} className={`globe${ready ? ' is-ready' : ''}`} role="group" aria-label={label}>
      <div className="globe-shade" aria-hidden="true" />
      <div ref={stage} className="globe-stage" aria-hidden="true" />
      <div ref={tip} className="globe-tip-spot" aria-hidden="true">
        {hover ? (
          <div className="globe-tip">
            <span className="globe-tip-name">
              <Flag code={hover} /> {countryName(hover)}
            </span>
            <span className="globe-tip-count">{plural(values[hover] ?? 0, 'link')}</span>
          </div>
        ) : null}
      </div>
      {most > 1 ? (
        <div className="globe-legend" aria-hidden="true">
          <span>1 link</span>
          <i style={{ background: SCALE_GRADIENT }} />
          <span>{plural(most, 'link')}</span>
        </div>
      ) : null}
      <div className="globe-buttons">
        <button type="button" className="globe-button" onClick={() => earth.current?.zoom(1)} aria-label="Zoom in" title="Zoom in" disabled={!ready}>
          <Plus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="globe-button" onClick={() => earth.current?.zoom(-1)} aria-label="Zoom out" title="Zoom out" disabled={!ready}>
          <Minus size={16} aria-hidden="true" />
        </button>
        <button type="button" className="globe-button" onClick={() => earth.current?.reset()} aria-label="Back to the start" title="Back to the start" disabled={!ready}>
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
