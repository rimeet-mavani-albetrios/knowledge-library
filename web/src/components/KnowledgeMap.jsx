// The map at the top: one dot per link, placed by meaning, colored by category.
// Searching or filtering lights up the matching dots; hover a dot to see its name, click to open it.
// Next to the search box on the home page. On phones it waits behind the toolbar's Map button,
// and opens as a wide `panel` above the results.
//
// A big library has a thousand dots or more, so they are drawn once and never redrawn: a search or filter
// dims them all with one style change and draws only the matching dots again, on top. Hovering draws its
// highlight on top as well. (Redrawing every dot on each click froze the page for a moment.)
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.js';
import { categoryStyle, hueOf } from '../categories.jsx';
import { useLinks } from '../useLinks.js';
import { useWidth } from '../hooks.js';

const WIDTH = 700;
const HEIGHT = 434;
const PAD = 48;

// Moves labels up or down a little until they don't cover each other (and stay inside the map).
// A label with no free spot left is skipped, so names never print on top of each other.
function avoidOverlaps(labels) {
  const placed = [];
  return labels.filter(label => {
    const width = label.text.length * label.fontSize * 0.6;
    const height = label.fontSize * 1.15;
    const clampX = Math.min(Math.max(label.x, width / 2 + 8), WIDTH - width / 2 - 8);
    const box = y => ({ left: clampX - width / 2, right: clampX + width / 2, top: y - height, bottom: y });
    const hits = b => placed.some(o => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top);
    for (const shift of [0, -height, height * 1.9, -height * 2, height * 2.9, -height * 3]) {
      const y = Math.min(Math.max(label.y + shift, height + 4), HEIGHT - 6);
      if (!hits(box(y))) {
        placed.push(box(y));
        label.x = clampX;
        label.y = y;
        return true;
      }
    }
    return false;
  });
}

// One dot: a soft halo and the colored core. `data-id` tells the map which link is under the mouse.
function Dot({ point, radius, halo, className = 'map-dot', delay }) {
  return (
    <g data-id={point.id} className={className} style={{ ...hueOf(point.category), animationDelay: delay }}>
      <circle cx={point.cx} cy={point.cy} r={halo} className="map-halo" />
      <circle cx={point.cx} cy={point.cy} r={radius} className="map-core" />
    </g>
  );
}

// Every dot, drawn once. It only draws again when the dots themselves or their size change.
const AllDots = memo(function AllDots({ placed, size }) {
  return (
    <g className="map-all">
      {placed.map(point => (
        <Dot key={point.id} point={point} radius={size} halo={size * 2.6} delay={`${Math.min(point.index * 18, 900)}ms`} />
      ))}
    </g>
  );
});

export default function KnowledgeMap({ params, panel = false, onOpen }) {
  const map = useQuery({ queryKey: ['map'], queryFn: () => api('/map'), staleTime: 60_000 });
  const links = useLinks(params);
  const [hovered, setHovered] = useState(null);
  const frame = useRef(null);
  const points = map.data?.points ?? [];

  // The dots pop in once. After that they stay put, even when a search moves the lit ones to the front.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!points.length || settled) return;
    const timer = setTimeout(() => setSettled(true), 1600);
    return () => clearTimeout(timer);
  }, [points.length, settled]);

  // Which dots to light up.
  const { q, category, source, collection, tag, level, status, favorite, free, broken } = params;
  const narrowed = q || source || collection || tag || level || status || favorite || free || broken;
  const lit = useMemo(() => {
    if (narrowed) return new Set((links.data?.pages ?? []).flatMap(page => page.items.map(link => link.id)));
    if (category) return new Set(points.filter(point => point.category === category).map(point => point.id));
    return null; // nothing chosen: every dot is normal
  }, [narrowed, category, links.data, points]);

  // Dots and labels keep the same size on screen, however big the map is drawn.
  const width = useWidth(frame, 600);
  const unit = WIDTH / width; // map units per screen pixel
  const small = width < 480;
  const dotPx = points.length > 900 ? 2 : points.length > 300 ? 2.8 : points.length > 40 ? 4 : 6;
  const size = dotPx * unit;
  // A small library shows each link's name next to its dot; a big one shows the category names instead.
  const showNames = points.length <= 30;
  const placed = useMemo(
    () =>
      points.map((point, index) => ({
        ...point,
        index,
        cx: PAD + point.x * (WIDTH - PAD * 2),
        cy: PAD + (1 - point.y) * (HEIGHT - PAD * 2),
      })),
    [points],
  );

  const labels = useMemo(() => {
    const wanted = showNames
      ? placed.map(point => ({
          key: point.id,
          category: point.category,
          text: point.title.length > 22 ? `${point.title.slice(0, 21)}…` : point.title,
          x: point.cx,
          y: point.cy - size * 2.4,
          fontSize: (small ? 11 : 13) * unit,
        }))
      : // One label in the middle of each big category's dots.
        [...Map.groupBy(placed, point => point.category)]
          .filter(([, members]) => members.length >= 2)
          .sort((a, b) => b[1].length - a[1].length)
          .slice(0, small ? 5 : 7)
          .map(([name, members]) => ({
            key: name,
            category: name,
            text: categoryStyle(name).short,
            x: members.reduce((sum, point) => sum + point.cx, 0) / members.length,
            y: members.reduce((sum, point) => sum + point.cy, 0) / members.length - size * 3.2,
            fontSize: (small ? 14 : 17.5) * unit,
          }));
    return avoidOverlaps(wanted);
  }, [placed, size, unit, small, showNames]);

  // The matching dots, drawn again on top of the dimmed ones. Usually a few dozen, so it's quick.
  const litDots = useMemo(
    () =>
      lit &&
      placed
        .filter(point => lit.has(point.id))
        .map(point => <Dot key={point.id} point={point} radius={size * 1.7} halo={size * 2.6} className="map-dot is-lit" />),
    [lit, placed, size],
  );
  const byId = useMemo(() => new Map(placed.map(point => [point.id, point])), [placed]);
  // One listener for all the dots: which dot is under the mouse, or was clicked.
  const dotAt = event => byId.get(event.target.closest?.('[data-id]')?.dataset.id);
  const onPointerOver = event => setHovered(dotAt(event) ?? null);
  const onClick = event => {
    const point = dotAt(event);
    if (point) onOpen(point.id);
  };
  const names = labels.map(label => (
    <text
      key={label.key}
      x={label.x}
      y={label.y}
      className={`map-label${showNames ? ' is-name' : ''}${lit && !(showNames ? lit.has(label.key) : true) ? ' is-dim' : ''}${lit && !showNames ? ' is-faded' : ''}`}
      style={{ ...hueOf(label.category), '--label-size': label.fontSize, strokeWidth: 6 * Math.min(unit, 1.6) }}
      textAnchor="middle"
    >
      {label.text}
    </text>
  ));

  return (
    <figure className={`map${lit ? ' is-narrowed' : ''}${panel ? ' is-panel' : ''}${settled ? ' is-settled' : ''}`}>
      <div className="map-frame" id="map-frame" ref={frame}>
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Map of the library: ${points.length} links, grouped by meaning`}
          onPointerOver={onPointerOver}
          onPointerLeave={() => setHovered(null)}
          onClick={onClick}
        >
          {/* Faint lines between neighbours of the hovered dot's category, so the "territory" shows. */}
          {hovered &&
            placed
              .filter(point => point.category === hovered.category && point.id !== hovered.id)
              .map(point => (
                <line
                  key={`l${point.id}`}
                  x1={hovered.cx}
                  y1={hovered.cy}
                  x2={point.cx}
                  y2={point.cy}
                  className="map-link"
                  style={hueOf(point.category)}
                />
              ))}
          <AllDots placed={placed} size={size} />
          {/* While searching, the category names go under the lit dots so they never hide a result. */}
          {lit && !showNames && names}
          {litDots && <g className="map-lit">{litDots}</g>}
          {!(lit && !showNames) && names}
          {hovered && (
            <Dot point={hovered} radius={size * 1.8} halo={size * 2.6} className="map-dot is-hovered" />
          )}
        </svg>

        {hovered && (
          <div
            className="map-tip"
            style={{ left: `${(hovered.cx / WIDTH) * 100}%`, top: `${(hovered.cy / HEIGHT) * 100}%`, ...hueOf(hovered.category) }}
            aria-hidden="true"
          >
            <span>{categoryStyle(hovered.category).short}</span>
            {hovered.title}
          </div>
        )}

        {!map.isLoading && points.length === 0 && (
          <p className="map-empty">Your map appears here as you add links.</p>
        )}
      </div>
      <figcaption>
        {map.isLoading
          ? 'Drawing the map…'
          : lit && points.length > 0
            ? 'Bright dots are your results.'
            : points.length > 0
              ? 'Each dot is a link. Dots close together are about similar things.'
              : 'Links about similar things will sit close together.'}
      </figcaption>
    </figure>
  );
}
