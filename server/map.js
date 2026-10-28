// The knowledge map: every link becomes a dot, placed so that links about similar things sit close together.
//
// Each link already has a "meaning fingerprint" of 384 numbers. To draw it on a flat map we squeeze those
// 384 numbers into 2 (x and y) with PCA: it finds the two directions in which the links differ the most.
// The result is cached and only recalculated after the library changes.
import { query } from './db.js';

const MAX_DOTS = 2000;
let cache = { key: '', points: [] };

// Finds the direction in which the (centered) vectors spread the most, by "power iteration".
function topDirection(vectors, dims) {
  let direction = new Float64Array(dims).fill(1 / Math.sqrt(dims)); // same start every time = stable map
  for (let round = 0; round < 60; round++) {
    const next = new Float64Array(dims);
    for (const v of vectors) {
      let dot = 0;
      for (let i = 0; i < dims; i++) dot += v[i] * direction[i];
      for (let i = 0; i < dims; i++) next[i] += dot * v[i];
    }
    const length = Math.hypot(...next) || 1;
    for (let i = 0; i < dims; i++) next[i] /= length;
    direction = next;
  }
  // Flip so the biggest part points the same way each time (keeps the map from mirroring after a change).
  let biggest = 0;
  for (let i = 1; i < dims; i++) if (Math.abs(direction[i]) > Math.abs(direction[biggest])) biggest = i;
  if (direction[biggest] < 0) for (let i = 0; i < dims; i++) direction[i] = -direction[i];
  return direction;
}

function project(vectors) {
  const dims = vectors[0].length;
  const mean = new Float64Array(dims);
  for (const v of vectors) for (let i = 0; i < dims; i++) mean[i] += v[i] / vectors.length;
  const centered = vectors.map(v => v.map((value, i) => value - mean[i]));

  const first = topDirection(centered, dims);
  // Remove the first direction, then find the next one.
  const rest = centered.map(v => {
    let dot = 0;
    for (let i = 0; i < dims; i++) dot += v[i] * first[i];
    return v.map((value, i) => value - dot * first[i]);
  });
  const second = topDirection(rest, dims);

  const xy = centered.map(v => {
    let x = 0;
    let y = 0;
    for (let i = 0; i < dims; i++) {
      x += v[i] * first[i];
      y += v[i] * second[i];
    }
    return [x, y];
  });
  // Scale into 0…1 on both axes.
  const scale = axis => {
    const values = xy.map(point => point[axis]);
    const min = Math.min(...values);
    const range = Math.max(...values) - min || 1;
    return value => (value - min) / range;
  };
  const sx = scale(0);
  const sy = scale(1);
  return xy.map(([x, y]) => [sx(x), sy(y)]);
}

export async function libraryMap() {
  const { rows: [state] } = await query(
    `SELECT count(*)::int AS n, max(updated_at) AS changed FROM links WHERE embedding IS NOT NULL`,
  );
  const key = `${state.n}:${state.changed}`;
  if (cache.key === key) return cache.points;

  const { rows } = await query(
    `SELECT id, title, category, embedding::text AS embedding FROM links WHERE embedding IS NOT NULL
     ORDER BY created_at DESC LIMIT ${MAX_DOTS}`,
  );
  let positions;
  if (rows.length < 3) {
    positions = rows.map((_, i) => [0.35 + i * 0.3, 0.5]);
  } else {
    positions = project(rows.map(row => Float64Array.from(JSON.parse(row.embedding))));
  }
  const points = rows.map((row, i) => ({
    id: row.id,
    title: row.title,
    category: row.category,
    x: Math.round(positions[i][0] * 1000) / 1000,
    y: Math.round(positions[i][1] * 1000) / 1000,
  }));
  cache = { key, points };
  return points;
}
