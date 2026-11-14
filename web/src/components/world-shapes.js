// The shapes of the countries for WorldMap.jsx, worked out once. This file (with the map data and the map maths) is
// loaded only when a map is first shown, so the rest of the site doesn't wait for it.
// The map data (world-atlas, "110m": small and simple) names countries by number (840 = United States); the rest of
// the app uses two-letter codes ("US"), so ISO_CODES (country-codes.js) turns one into the other.
import { feature } from 'topojson-client';
import { geoCentroid, geoEqualEarth, geoPath } from 'd3-geo';
import world from 'world-atlas/countries-110m.json';
import { BY_NAME, ISO_CODES, SMALL } from './country-codes.js';

export const WIDTH = 960;
export const HEIGHT = 421; // the world without Antarctica is this tall at this width (Equal Earth projection)

// Countries drawn so small (in the map's own units, at 960 wide) that they are hard to see or click, like the UAE,
// Israel, Belgium or Qatar: they keep their shape and also get a bubble.
const TINY_AREA = 65;

// [{ code, d }] for the countries (Antarctica left out: nothing comes from there and it takes a lot of room),
// and [{ code, x, y, tiny }] for the bubbles: countries not on the map, and tiny ones (`tiny`: it also has a shape).
export function worldShapes() {
  const countries = feature(world, world.objects.countries).features.filter(country => country.id !== '010');
  const projection = geoEqualEarth().fitSize([WIDTH, HEIGHT], { type: 'FeatureCollection', features: countries });
  const path = geoPath(projection).digits(1);
  const round = n => Math.round(n * 10) / 10;
  const shapes = [];
  const tiny = new Map(); // code → { area, x, y } of its biggest piece, when all its pieces are tiny
  const big = new Set();
  for (const country of countries) {
    const code = ISO_CODES[country.id] ?? BY_NAME[country.properties.name] ?? '';
    const d = path(country);
    if (!code || !d) continue;
    shapes.push({ code, d });
    const area = path.area(country);
    if (area >= TINY_AREA) big.add(code);
    else if (!(tiny.get(code)?.area > area)) {
      // The middle on the globe, not on the flat map: Fiji lies on both edges of the map.
      const [x, y] = projection(geoCentroid(country));
      tiny.set(code, { area, x: round(x), y: round(y) });
    }
  }
  const drawn = new Set(shapes.map(shape => shape.code));
  const dots = [
    ...[...tiny].filter(([code]) => !big.has(code)).map(([code, { x, y }]) => ({ code, x, y, tiny: true })),
    ...SMALL.filter(([code]) => !drawn.has(code)).map(([code, lon, lat]) => {
      const [x, y] = projection([lon, lat]);
      return { code, x: round(x), y: round(y), tiny: false };
    }),
  ];
  return { shapes, dots };
}
