// The land's shapes, and how to paint them. The page uses this, and so does the painter in the background
// (land-worker.js), so both make the same picture. Nothing here may touch the page: the painter can't see it.
import { rgba } from './colors.js';

// A blank canvas: not part of the page, so the painter in the background can have one too.
export const newCanvas = (width, height) => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

// Reads a path like "M10 20l5 5-3 2z…" (the only kind the server writes) into rings of whole-number points.
function readRings(d) {
  const rings = [];
  const numbers = /-?\d+/g;
  for (const part of d.split('M')) {
    if (!part) continue;
    numbers.lastIndex = 0;
    let match = numbers.exec(part);
    let x = Number(match[0]);
    match = numbers.exec(part);
    let y = Number(match[0]);
    const ring = [x, y];
    while ((match = numbers.exec(part))) {
      x += Number(match[0]);
      match = numbers.exec(part);
      y += Number(match[0]);
      ring.push(x, y);
    }
    rings.push(ring);
  }
  return rings;
}

// Draws rings as smooth curves: from the middle of one line to the middle of the next, bending at the point between
// them. The server's points are far apart when you zoom in close, and this keeps coasts round instead of angular.
// `box` is the rectangle it all fits in, so a shape that's off the picture can be skipped.
function shapeOf(rings) {
  const path = new Path2D();
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) {
    const count = ring.length / 2;
    if (count < 3) continue;
    const last = count - 1;
    path.moveTo((ring[last * 2] + ring[0]) / 2, (ring[last * 2 + 1] + ring[1]) / 2);
    for (let i = 0; i < count; i++) {
      const next = i === last ? 0 : i + 1;
      const x = ring[i * 2];
      const y = ring[i * 2 + 1];
      path.quadraticCurveTo(x, y, (x + ring[next * 2]) / 2, (y + ring[next * 2 + 1]) / 2);
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
    path.closePath();
  }
  return { path, box };
}

// The server's paths (see server/land.js) as shapes that are ready to paint. Each height line is a shape of its own:
// close in, only a few of them are in sight.
export function readLand(land) {
  return {
    scale: land.scale,
    coast: shapeOf(readRings(land.coast)),
    countries: land.countries.map(({ category, d }) => ({ category, ...shapeOf(readRings(d)) })),
    heights: land.heights.flatMap(d => readRings(d).map(ring => shapeOf([ring]))),
  };
}

// The soft light in the water around the coast: painted once, then only stretched along with the map.
// (A canvas blurs a shadow in every browser, unlike its `filter`, which Safari doesn't have.)
export function makeGlow(land, colors, aspect) {
  const width = 1100;
  const pad = 90;
  const height = Math.round(width * aspect);
  const picture = newCanvas(width + pad * 2, height + pad * 2);
  const ctx = picture.getContext('2d');
  const unit = width / land.scale;
  // The shape is drawn far outside the picture, and only its shadow falls inside.
  const away = picture.width * 2;
  const soft = (blur, alpha) => {
    ctx.save();
    ctx.shadowColor = rgba(colors.shore, alpha);
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = away;
    ctx.setTransform(unit, 0, 0, unit, pad - away, pad);
    ctx.fillStyle = '#000';
    ctx.fill(land.coast.path, 'evenodd');
    ctx.restore();
  };
  soft(46, colors.dark ? 0.75 : 0.85);
  soft(20, colors.dark ? 0.8 : 0.95);
  soft(7, colors.dark ? 0.75 : 1);
  return { picture, pad, width };
}

// Paints the land on a canvas. unit: canvas pixels per path unit; x, y: where the map's corner goes on the canvas;
// width, height: the canvas's size, for skipping what's off it (when you're close in, that's most of the map).
// `full` adds the fine details (the soft band inside each country's edge, and the height lines): faint, and most of
// the work, so they wait until the map is at rest.
export function paintLand(ctx, land, colors, glow, { unit, x, y, line, full, width, height }) {
  const { coast, countries, heights, scale } = land;
  const inSight = ({ box }) => box[2] * unit + x >= 0 && box[0] * unit + x <= width && box[3] * unit + y >= 0 && box[1] * unit + y <= height;
  const stretch = (scale * unit) / glow.width;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(glow.picture, x - glow.pad * stretch, y - glow.pad * stretch, glow.picture.width * stretch, glow.picture.height * stretch);

  ctx.setTransform(unit, 0, 0, unit, x, y);
  ctx.lineJoin = 'round';
  ctx.fillStyle = rgba(colors.land);
  ctx.fill(coast.path, 'evenodd');

  // The countries, biggest first, each with its outline. Countries reach a little over their borders, so a later one
  // covers the edge of an earlier one: one line per border, and no gaps where three countries meet (see land.js).
  // Inside its edge each country has a soft band of its own color, like the countries in a printed atlas.
  const band = (line * 7) / unit;
  for (const country of countries) {
    if (!inSight(country)) continue;
    const { category, path } = country;
    ctx.fillStyle = rgba(colors.tint.get(category) ?? colors.land);
    ctx.fill(path, 'evenodd');
    if (full) {
      ctx.save();
      ctx.clip(path, 'evenodd');
      ctx.strokeStyle = rgba(colors.hue.get(category) ?? colors.muted, colors.dark ? 0.16 : 0.2);
      ctx.lineWidth = band;
      ctx.stroke(path);
      ctx.restore();
    }
    ctx.strokeStyle = rgba(colors.border);
    ctx.lineWidth = line / unit;
    ctx.stroke(path);
  }

  // Height lines, like a hiking map.
  if (full) {
    ctx.strokeStyle = rgba(colors.contour);
    for (const height of heights) {
      if (inSight(height)) ctx.stroke(height.path);
    }
  }

  ctx.strokeStyle = rgba(colors.coast);
  ctx.lineWidth = (line * 1.15) / unit;
  ctx.stroke(coast.path);
}
