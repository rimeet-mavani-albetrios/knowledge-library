// The map at the top: a tiny atlas of the library. The land and its countries (categories) come from the server, with one
// dot per link on them, placed by meaning. Searching or filtering lights up the matching dots; hover a dot to see its name,
// click to open it. Next to the search box on the home page. On phones it waits behind the toolbar's Map button,
// and opens as a wide `panel` above the results.
//
// A big library has a thousand dots or more, so they are drawn once and never redrawn: a search or filter
// dims them all with one style change and draws only the matching dots again, on top. Hovering draws its
// highlight on top as well. (Redrawing every dot on each click froze the page for a moment.)
// The thousand dots are a few dozen shapes (one per category), not thousands of elements: every window that
// opens makes the browser look at each element on the page again, and 3,000 dot elements made that slow.
// Which dot the mouse is on comes from the dots' positions (dotNear), not from the shapes.
//
// The way into the Explore page (the same map on the whole screen, to move around in): the "Explore map" button in
// the corner, or a click on the map's empty space, which glides Explore in to the island nearest that spot.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Telescope } from 'lucide-react';
import { api, toQuery } from '../api.js';
import { categoryStyle, hueOf } from '../categories.jsx';
import { linkFilters, useLinks } from '../useLinks.js';
import './knowledge-map.css';

// Explore's code and its bigger map data are fetched as soon as you point at the way in, so it opens at once.
const loadExplore = () => import('./Explore.jsx');

const NONE = []; // the same empty list each time, so nothing is worked out again for nothing
const WIDTH = 1000; // the picture is drawn at this width; its height follows from the shape of the land
const PAD = 26;
const FALLBACK_SIZE = { width: 600, height: 270 };

// How big an element is on screen, kept up to date when the window changes size.
function useBoxSize(ref, fallback) {
  const [size, setSize] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const read = () => {
      if (element.clientWidth && element.clientHeight) setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

// Moves labels up or down a little until they don't cover each other (and stay inside the map).
// A label with no free spot left is skipped, so names never print on top of each other.
function avoidOverlaps(labels, height) {
  const placed = [];
  return labels.filter(label => {
    const width = label.text.length * label.fontSize * 0.6;
    const tall = label.fontSize * 1.15;
    const clampX = Math.min(Math.max(label.x, width / 2 + 8), WIDTH - width / 2 - 8);
    const box = y => ({ left: clampX - width / 2, right: clampX + width / 2, top: y - tall, bottom: y });
    const hits = b => placed.some(o => b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top);
    for (const shift of [0, -tall, tall * 1.9, -tall * 2, tall * 2.9, -tall * 3]) {
      const y = Math.min(Math.max(label.y + shift, tall + 4), height - 6);
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

// A dot as part of a path: a tiny line with round ends. Many of them make one shape, and they are much shorter to write
// than circles.
const spot = point => `M${point.cx.toFixed(1)} ${point.cy.toFixed(1)}h.01`;

// A circle as part of a path: many of them make one shape.
const circle = (point, r) => `M${(point.cx - r).toFixed(1)} ${point.cy.toFixed(1)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

// The land and its countries, in the category colors. It never changes while you search, so it's drawn only once.
const Land = memo(function Land({ land, across }) {
  return (
    <g className="map-land" transform={`translate(${PAD} ${PAD}) scale(${across / land.scale})`}>
      <path className="map-land-base" d={land.coast} />
      {land.countries.map(country => (
        <path key={country.category} className="map-country" style={hueOf(country.category)} d={country.d} />
      ))}
      <path className="map-land-coast" d={land.coast} />
    </g>
  );
});

// Every dot, drawn once: per category, one shape, on one thin bright outline shape under them all.
// It only draws again when the dots themselves or their size change.
const AllDots = memo(function AllDots({ placed, size }) {
  const territories = useMemo(() => [...Map.groupBy(placed, point => point.category)], [placed]);
  const outline = useMemo(() => placed.map(spot).join(''), [placed]);
  const width = Number((size * 2).toFixed(2));
  return (
    <g className="map-all">
      <path className="map-dots-outline" d={outline} style={{ strokeWidth: width * 1.5 }} />
      {territories.map(([category, points], index) => (
        <g key={category} className="map-territory" style={{ ...hueOf(category), animationDelay: `${Math.min(index * 45, 900)}ms` }}>
          <path className="map-dots" d={points.map(spot).join('')} style={{ strokeWidth: width }} />
        </g>
      ))}
    </g>
  );
});

// The dots a search or filter lights up, drawn again on top of the dimmed ones: one shape per category too, because a
// filter can match hundreds of links.
const LitDots = memo(function LitDots({ placed, lit, size }) {
  const groups = useMemo(() => [...Map.groupBy(placed.filter(point => lit.has(point.id)), point => point.category)], [placed, lit]);
  const r = Number((size * 1.9).toFixed(2));
  const halo = Number((size * 4).toFixed(2));
  return (
    <g className="map-lit">
      {groups.map(([category, points]) => (
        <g key={category} className="map-dot is-lit" style={hueOf(category)}>
          <path className="map-halo" d={points.map(point => circle(point, halo)).join('')} />
          <path className="map-core" d={points.map(point => circle(point, r)).join('')} />
        </g>
      ))}
    </g>
  );
});

function KnowledgeMap({ params, panel = false, onOpen, onExplore }) {
  const map = useQuery({ queryKey: ['map'], queryFn: () => api('/map'), staleTime: 60_000 });
  const queryClient = useQueryClient();
  const getReady = () => loadExplore().then(module => queryClient.prefetchQuery(module.exploreQuery));
  const links = useLinks(params);
  const [hovered, setHovered] = useState(null);
  const frame = useRef(null);
  const points = map.data?.points ?? [];
  const islands = map.data?.islands ?? NONE;

  // The dots pop in once. After that they stay put, even when a search moves the lit ones to the front.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!points.length || settled) return;
    const timer = setTimeout(() => setSettled(true), 1600);
    return () => clearTimeout(timer);
  }, [points.length, settled]);

  // Which dots to light up.
  const { q, category, source, collection, tag, level, status, favorite, free, broken, country, trust } = params;
  const narrowed = Boolean(q || source || collection || tag || level || status || favorite || free || broken || country || trust);
  // Every link of the search or filter lights up, not only the ones the list has loaded so far (those show until the
  // answer comes, and for a search with only "the nearest links" to show).
  const filters = { ...linkFilters(params), sort: undefined };
  const every = useQuery({
    queryKey: ['map', 'lit', filters],
    queryFn: ({ signal }) => api(`/map/lit?${toQuery(filters)}`, { signal }),
    enabled: narrowed,
    staleTime: 60_000,
  }).data?.ids;
  const lit = useMemo(() => {
    if (narrowed) return new Set(every?.length ? every : (links.data?.pages ?? []).flatMap(page => page.items.map(link => link.id)));
    if (category) return new Set(points.filter(point => point.category === category).map(point => point.id));
    return null; // nothing chosen: every dot is normal
  }, [narrowed, category, every, links.data, points]);

  // The picture has the shape of the land. It's as big as fits the frame, in the middle, with sea left and right.
  const aspect = map.data?.aspect ?? 0.62;
  const land = map.data?.land;
  const across = WIDTH - PAD * 2;
  const HEIGHT = Math.round(aspect * across + PAD * 2);
  const { width, height } = useBoxSize(frame, FALLBACK_SIZE);
  const fit = Math.min(width / WIDTH, height / HEIGHT);

  // Dots and labels keep the same size on screen, however big the map is drawn.
  const unit = 1 / fit; // map units per screen pixel
  const small = width < 480;
  const dotPx = points.length > 900 ? 1.35 : points.length > 300 ? 2 : points.length > 40 ? 3.2 : 5;
  const size = dotPx * unit;
  // A small library shows each link's name next to its dot; a big one shows the category names instead.
  const showNames = points.length <= 30;
  const placed = useMemo(
    () =>
      points.map((point, index) => ({
        ...point,
        index,
        cx: PAD + point.x * across,
        cy: PAD + (1 - point.y) * aspect * across,
      })),
    [points, across, aspect],
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
      : islands.length
        ? // One label on the main land of each big category (from the server).
          islands
            .filter((island, index) => islands.findIndex(other => other.name === island.name) === index)
            .slice(0, small ? 6 : 8)
            .map(island => ({
              key: island.name,
              category: island.name,
              text: categoryStyle(island.name).short,
              x: PAD + island.x * across,
              y: PAD + (1 - island.y) * aspect * across + 5 * unit,
              fontSize: (small ? 11.5 : 12.5) * unit,
            }))
        : // One label in the middle of each big category's dots.
          [...Map.groupBy(placed, point => point.category)]
            .filter(([, members]) => members.length >= 2)
            .sort((a, b) => b[1].length - a[1].length)
            .slice(0, small ? 6 : 8)
            .map(([name, members]) => ({
              key: name,
              category: name,
              text: categoryStyle(name).short,
              x: members.reduce((sum, point) => sum + point.cx, 0) / members.length,
              y: members.reduce((sum, point) => sum + point.cy, 0) / members.length + 5 * unit,
              fontSize: (small ? 11.5 : 12.5) * unit,
            }));
    return avoidOverlaps(wanted, HEIGHT);
  }, [placed, islands, size, unit, small, showNames, across, aspect, HEIGHT]);

  // The dot nearest the mouse, within a few screen pixels (a little more forgiving than the dot itself).
  const svgRef = useRef(null);
  const dotNear = event => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return null;
    const { x, y } = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    let best = null;
    let bestDistance = (8 * unit) ** 2;
    for (const point of placed) {
      const distance = (point.cx - x) ** 2 + (point.cy - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = point;
      }
    }
    return best;
  };
  const onPointerMove = event => {
    if (event.pointerType === 'touch') return;
    const point = dotNear(event);
    if (point?.id !== hovered?.id) setHovered(point);
  };
  const onClick = event => {
    const point = dotNear(event);
    if (point) onOpen(point.id);
    else if (onExplore && points.length) {
      // The spot you clicked, in the map's own 0…1 numbers (y counts up from the bottom, like the server's).
      const matrix = svgRef.current?.getScreenCTM();
      const clicked = matrix && new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      onExplore(
        clicked && {
          x: Math.min(Math.max((clicked.x - PAD) / across, 0), 1),
          y: Math.min(Math.max(1 - (clicked.y - PAD) / (aspect * across), 0), 1),
        },
      );
    }
  };
  const names = labels.map(label => (
    <text
      key={label.key}
      x={label.x}
      y={label.y}
      className={`map-label${showNames ? ' is-name' : ''}${lit && !(showNames ? lit.has(label.key) : true) ? ' is-dim' : ''}${lit && !showNames ? ' is-faded' : ''}`}
      style={{ ...hueOf(label.category), '--label-size': label.fontSize, strokeWidth: 3.5 * unit }}
      textAnchor="middle"
    >
      {label.text}
    </text>
  ));

  return (
    <figure className={`map${lit ? ' is-narrowed' : ''}${panel ? ' is-panel' : ''}${settled ? ' is-settled' : ''}${onExplore ? ' can-explore' : ''}`}>
      <div className="map-frame" id="map-frame" ref={frame} onPointerEnter={onExplore && points.length ? getReady : undefined}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`Map of the library: ${points.length} links, grouped by meaning`}
          className={hovered ? 'is-pointing' : undefined}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
          onClick={onClick}
        >
          {land && <Land land={land} across={across} />}
          <AllDots placed={placed} size={size} />
          {/* While searching, the category names go under the lit dots so they never hide a result. */}
          {lit && !showNames && names}
          {lit && <LitDots placed={placed} lit={lit} size={size} />}
          {!(lit && !showNames) && names}
          {hovered && (
            <Dot point={hovered} radius={size * 2.1} halo={size * 4} className="map-dot is-hovered" />
          )}
        </svg>

        {hovered && (
          <div
            className="map-tip"
            style={{ left: (width - WIDTH * fit) / 2 + hovered.cx * fit, top: (height - HEIGHT * fit) / 2 + hovered.cy * fit, ...hueOf(hovered.category) }}
            aria-hidden="true"
          >
            <span>{categoryStyle(hovered.category).short}</span>
            {hovered.title}
          </div>
        )}

        {!map.isLoading && points.length === 0 && (
          <p className="map-empty">Your map appears here as you add links.</p>
        )}
        {onExplore && points.length > 0 && (
          <button type="button" className="map-explore" onClick={() => onExplore(null)} onFocus={getReady}>
            <Telescope size={15} aria-hidden="true" />
            Explore map
          </button>
        )}
      </div>
      <figcaption>
        {map.isLoading
          ? 'Drawing the map…'
          : lit && points.length > 0
            ? 'Bright dots are your results.'
            : points.length > 0
              ? onExplore
                ? 'Each dot is a link. Click a dot to open it, or the map to explore.'
                : 'Each dot is a link. Dots close together are about similar things.'
              : 'Links about similar things will sit close together.'}
      </figcaption>
    </figure>
  );
}

// A thousand dots: only drawn again when the search, the filters or the map's own data change.
export default memo(KnowledgeMap);
