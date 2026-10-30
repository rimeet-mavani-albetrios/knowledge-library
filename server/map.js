// The knowledge map: every link becomes a dot, placed so that links about similar things sit close together.
//
// Each link already has a "meaning fingerprint" of 384 numbers. To draw it on a flat map we need just 2 (x and y).
// Squeezing all 384 into 2 at once (the old way, PCA) put most dots in one crowded blob in the middle. Now the map
// is built the way UMAP and Nomic Atlas do it, and then made into a real map, in 6 steps:
//   1. For every link, find its 15 closest links by meaning (its "neighbours").
//   2. Start from a rough picture (PCA), then let the dots settle: each dot is pulled toward its neighbours and
//      pushed away from a few random other dots. Links that share neighbours end up as clear islands, with
//      space between the islands. Ties inside a category count more, so the islands match the categories.
//   3. Turn the map so it is wider than tall, pull far-off islands in a little, and scale it into 0…1.
//   4. Find names for the groups inside the islands (their most telling tags), while the groups are still easy to see.
//   5. Spread the dots out: settling leaves tight little knots and long empty gaps, which would make thin, stringy land.
//      Now each dot gets elbow room, like a crowd shuffling apart, so the land fills up evenly and dots can be told apart.
//   6. Draw the land around the dots: coasts, countries and height lines (land.js), and name each category's main land.
//
// Same links in → same map out: the "random" dots come from a fixed seed, so the map never jumps around for
// nothing. The result is kept (in memory and in the database) until a link is added, removed or changed. Building
// it takes about 1.5 seconds for 1,000 links and 3 seconds for 2,000, and a few megabytes of memory; it stops for a
// breath every few milliseconds so other visitors aren't kept waiting while it runs.
import { getMeta, query, setMeta } from './db.js';
import { buildLand, gridAspect } from './land.js';

const MAX_DOTS = 2000;
const GRAPH_K = 15; // neighbours each dot is tied to while the map settles
const NEAR = 8; // closest links sent along for each link (Explore lights them up and draws lines to them)
const NEAR_MIN = 0.3; // …as long as they are at least this alike (1 = the same meaning)
const EPOCHS = 300; // rounds of settling
// A tie between two links of different categories counts this much. Meaning still decides who is near whom, but
// each category gathers into its own island, and the islands of related categories stay side by side.
const CROSS = 0.2;
const NEGATIVE = 5; // random dots each pull is balanced with a push from
const PULL_IN = 0.7; // how much far islands are pulled in toward the middle (1 = not at all)
const SEED = 20261030;
// How strongly dots feel each other: 1 ÷ (1 + A × distance²). (UMAP's curve for "min_dist 0.1" is close to this,
// with a power that is slow to work out; leaving the power out makes settling about 3 times faster.)
const A = 1.6;
const FILL = 0.42; // the share of the map the dots' elbow room should add up to: the rest is sea
const GRAVITY = 0.0012; // how strongly everything is pulled toward the middle while the dots spread out
const SPREAD_ROUNDS = 140; // rounds of shuffling apart
const SHAPE = 0.66; // the map's height ÷ width to aim for: a screen, without its bars and panels
const BIG_HUBS = 0.12; // the share of dots that count as "towns": many other links have them among their closest
const OFTEN_OPENED = 3; // opened this many times or more, a link is drawn as a city
const TOP_LINKS = 5; // links an island's card shows

// The last map is kept here, and in the database (meta row `map-v2`; a new version of this file can change the name
// so an old saved map is never used).
const SAVED = 'map-v2';
let cache = { key: '', map: null };
let building = null; // visitors who ask while the map is being built all wait for the same result

// Gives other requests a turn every ~30 ms of work, so a big map never freezes the server.
let lastBreath = 0;
async function breathe() {
  if (performance.now() - lastBreath < 30) return;
  await new Promise(resolve => setImmediate(resolve));
  lastBreath = performance.now();
}

// The same "random" numbers every time (mulberry32), so the same library always gives the same map.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Step 1: the closest links of every link ----------

// All fingerprints in one long list of numbers (n × dims), each scaled to length 1, so
// "how alike" is simply the sum of the products of the numbers.
// (Rows are padded with zeros to a multiple of 4 numbers, for the 4-at-a-time sums below.)
function unitVectors(fingerprints) {
  const dims = Math.ceil(fingerprints[0].length / 4) * 4;
  const all = new Float32Array(fingerprints.length * dims);
  fingerprints.forEach((values, i) => {
    let length = 0;
    for (const value of values) length += value * value;
    length = Math.sqrt(length) || 1;
    values.forEach((value, d) => {
      all[i * dims + d] = value / length;
    });
  });
  return { all, dims };
}

// A sorted "best k" list for each of n links: who (best first) and how alike. `offer` puts a link in if it beats the
// weakest one there.
function bestLists(n, k) {
  const who = new Int32Array(n * k).fill(-1);
  const alike = new Float64Array(n * k).fill(-Infinity);
  const offer = (i, other, value) => {
    const row = i * k;
    if (value <= alike[row + k - 1]) return;
    let place = k - 1;
    while (place > 0 && alike[row + place - 1] < value) {
      alike[row + place] = alike[row + place - 1];
      who[row + place] = who[row + place - 1];
      place--;
    }
    alike[row + place] = value;
    who[row + place] = other;
  };
  return { who, alike, offer };
}

// Compares every link with every other link once (2,000 links = 2 million pairs) and keeps each one's k best.
// This is the slowest part of building the map, so the sum is done 4 numbers at a time (about 15% quicker in Node).
async function closestLinks({ all, dims }, n, k) {
  const best = bestLists(n, k);
  for (let i = 0; i < n; i++) {
    const a = i * dims;
    for (let j = i + 1; j < n; j++) {
      const b = j * dims;
      let s0 = 0;
      let s1 = 0;
      let s2 = 0;
      let s3 = 0;
      for (let d = 0; d < dims; d += 4) {
        s0 += all[a + d] * all[b + d];
        s1 += all[a + d + 1] * all[b + d + 1];
        s2 += all[a + d + 2] * all[b + d + 2];
        s3 += all[a + d + 3] * all[b + d + 3];
      }
      const sum = s0 + s1 + s2 + s3;
      best.offer(i, j, sum);
      best.offer(j, i, sum);
    }
    await breathe();
  }
  return best;
}

// ---------- Step 2: let the dots settle ----------

// Turns "closest links" into ties of a strength between 0 and 1. A link's very closest neighbour always gets a
// full-strength tie; the others get weaker ties the further they are, scaled for each link separately, so links in
// a crowded corner and lonely links both get a fair set of ties. A tie counts once for both of its links.
function ties({ who, alike }, n, k, groups) {
  const target = Math.log2(k);
  const strength = new Map(); // "smaller index × n + larger index" → [i→j strength, j→i strength]
  for (let i = 0; i < n; i++) {
    const row = i * k;
    const distances = [];
    for (let s = 0; s < k; s++) if (who[row + s] >= 0) distances.push(Math.max(0, 1 - alike[row + s]));
    if (!distances.length) continue;
    const nearest = distances[0];
    // Find the width that makes the strengths of all k ties add up to log2(k) (as UMAP does).
    let low = 0;
    let high = Infinity;
    let width = 1;
    for (let round = 0; round < 64; round++) {
      let total = 0;
      for (const distance of distances) total += Math.exp(-Math.max(0, distance - nearest) / width);
      if (Math.abs(total - target) < 1e-5) break;
      if (total > target) {
        high = width;
        width = (low + high) / 2;
      } else {
        low = width;
        width = high === Infinity ? width * 2 : (low + high) / 2;
      }
    }
    width = Math.max(width, 1e-3 * (distances.reduce((sum, d) => sum + d, 0) / distances.length));
    distances.forEach((distance, s) => {
      const j = who[row + s];
      const key = Math.min(i, j) * n + Math.max(i, j);
      const pair = strength.get(key) ?? [0, 0];
      pair[i < j ? 0 : 1] = Math.exp(-Math.max(0, distance - nearest) / width);
      strength.set(key, pair);
    });
  }
  // A tie both links chose is stronger than one only one of them chose: a + b - a·b.
  const edges = [];
  for (const [key, [a, b]] of strength) {
    const i = Math.floor(key / n);
    const j = key % n;
    edges.push([i, j, (a + b - a * b) * (groups[i] === groups[j] ? 1 : CROSS)]);
  }
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]); // a fixed order: the settling depends on it
  return edges;
}

// The rough first picture: the two directions in which the fingerprints differ the most (PCA, by "power iteration").
// The directions are learned from at most 500 links spread over the library (quick, and just as good for a rough
// start); then every link is placed along them.
function firstPicture({ all, dims }, n) {
  const mean = new Float64Array(dims);
  for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) mean[d] += all[i * dims + d] / n;
  const along = (i, direction) => {
    let sum = 0;
    for (let d = 0; d < dims; d++) sum += (all[i * dims + d] - mean[d]) * direction[d];
    return sum;
  };
  const sample = [];
  for (let i = 0; i < n; i += Math.max(1, n / 500)) sample.push(Math.floor(i));
  const directions = [];
  for (let axis = 0; axis < 2; axis++) {
    let direction = new Float64Array(dims).fill(1 / Math.sqrt(dims)); // same start every time = stable map
    for (let round = 0; round < 30; round++) {
      const next = new Float64Array(dims);
      for (const i of sample) {
        const dot = along(i, direction);
        for (let d = 0; d < dims; d++) next[d] += dot * (all[i * dims + d] - mean[d]);
      }
      // The second direction must not repeat the first one: take out the part that points along it.
      if (axis === 1) {
        const overlap = next.reduce((sum, value, d) => sum + value * directions[0][d], 0);
        for (let d = 0; d < dims; d++) next[d] -= overlap * directions[0][d];
      }
      const length = Math.sqrt(next.reduce((sum, value) => sum + value * value, 0)) || 1;
      direction = next.map(value => value / length);
    }
    directions.push(direction);
  }
  const xy = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    xy[i * 2] = along(i, directions[0]);
    xy[i * 2 + 1] = along(i, directions[1]);
  }
  return xy;
}

// Pulls tied dots together and pushes each one away from a few random dots, round after round, with smaller and
// smaller steps (UMAP's way of settling a map).
async function settle(xy, edges, n) {
  const random = seeded(SEED);
  // Spread the first picture over -10…10, and nudge every dot a hair, so two links with the very same
  // fingerprint (a link saved twice) don't stay stuck on the same spot.
  let biggest = 0;
  for (const value of xy) biggest = Math.max(biggest, Math.abs(value));
  for (let i = 0; i < xy.length; i++) xy[i] = (xy[i] / (biggest || 1)) * 10 + (random() - 0.5) * 0.02;

  // Every tie is used both ways (a pulls b, b pulls a). Weak ties are used less often than strong ones.
  const count = edges.length * 2;
  const from = new Int32Array(count);
  const to = new Int32Array(count);
  const every = new Float64Array(count); // use this tie once every `every` rounds
  let strongest = 0;
  for (const [, , weight] of edges) strongest = Math.max(strongest, weight);
  edges.forEach(([a, b, weight], e) => {
    from[e * 2] = a;
    to[e * 2] = b;
    from[e * 2 + 1] = b;
    to[e * 2 + 1] = a;
    every[e * 2] = every[e * 2 + 1] = weight > strongest / EPOCHS ? strongest / weight : Infinity;
  });
  const nextPull = Float64Array.from(every);
  const everyPush = every.map(value => value / NEGATIVE);
  const nextPush = Float64Array.from(everyPush);
  const clip = value => (value > 4 ? 4 : value < -4 ? -4 : value);

  for (let round = 0; round < EPOCHS; round++) {
    const step = 1 - round / EPOCHS;
    for (let e = 0; e < count; e++) {
      if (nextPull[e] > round) continue;
      const i = from[e];
      const j = to[e];
      let dx = xy[i * 2] - xy[j * 2];
      let dy = xy[i * 2 + 1] - xy[j * 2 + 1];
      let d2 = dx * dx + dy * dy;
      if (d2 > 0) {
        const pull = (-2 * A) / (A * d2 + 1);
        const gx = clip(pull * dx) * step;
        const gy = clip(pull * dy) * step;
        xy[i * 2] += gx;
        xy[i * 2 + 1] += gy;
        xy[j * 2] -= gx;
        xy[j * 2 + 1] -= gy;
      }
      nextPull[e] += every[e];

      const pushes = Math.floor((round - nextPush[e]) / everyPush[e]);
      for (let p = 0; p < pushes; p++) {
        const other = Math.floor(random() * n);
        if (other === i) continue;
        dx = xy[i * 2] - xy[other * 2];
        dy = xy[i * 2 + 1] - xy[other * 2 + 1];
        d2 = dx * dx + dy * dy;
        if (d2 > 0) {
          const push = 2 / ((0.001 + d2) * (A * d2 + 1));
          xy[i * 2] += clip(push * dx) * step;
          xy[i * 2 + 1] += clip(push * dy) * step;
        } else {
          xy[i * 2] += 4 * step;
        }
      }
      nextPush[e] += pushes * everyPush[e];
    }
    await breathe();
  }
  return xy;
}

// ---------- Step 3: turn and scale ----------

// Turns the map so its long side lies flat (the screen is wider than tall), always the same way round, and scales
// it so x runs 0…1 and y runs 0…1. `aspect` is height ÷ width, so Explore can draw the true shape.
// A few lonely dots far out are pulled in to the edge, so they don't shrink the whole map.
function fitToBox(xy, n) {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xy[i * 2] / n;
    my += xy[i * 2 + 1] / n;
  }
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xy[i * 2] - mx;
    const y = xy[i * 2 + 1] - my;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy); // the direction the dots spread the most
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = xy[i * 2] - mx;
    const y = xy[i * 2 + 1] - my;
    xs[i] = x * cos + y * sin;
    ys[i] = -x * sin + y * cos;
  }
  // Islands far out are pulled in a little (same direction, less distance), so the whole map isn't mostly empty sea
  // and the dots aren't tiny when you see all of it. Dots nearer the middle than most stay where they are.
  const reach = Float64Array.from(xs, (x, i) => Math.hypot(x, ys[i])).sort()[Math.floor(n / 2)] || 1;
  for (let i = 0; i < n; i++) {
    const distance = Math.hypot(xs[i], ys[i]);
    if (distance <= reach) continue;
    const pulled = reach * (distance / reach) ** PULL_IN;
    xs[i] *= pulled / distance;
    ys[i] *= pulled / distance;
  }
  // Mirror so the heavier side is always on the same side (otherwise a small change could flip the map over).
  for (const values of [xs, ys]) {
    let skew = 0;
    for (const value of values) skew += value ** 3;
    if (skew < 0) for (let i = 0; i < n; i++) values[i] = -values[i];
  }
  const edgesOf = values => {
    const sorted = Float64Array.from(values).sort();
    const low = sorted[Math.floor((n - 1) * 0.004)];
    const high = sorted[Math.ceil((n - 1) * 0.996)];
    const room = (high - low) * 0.03 || 1;
    return [low - room, high + room];
  };
  const [x0, x1] = edgesOf(xs);
  const [y0, y1] = edgesOf(ys);
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  const points = [];
  for (let i = 0; i < n; i++) points.push([(clamp(xs[i], x0, x1) - x0) / (x1 - x0), (clamp(ys[i], y0, y1) - y0) / (y1 - y0)]);
  return { points, aspect: (y1 - y0) / (x1 - x0) };
}

// ---------- Step 4: names for the groups inside the islands ----------

// Groups dots by where they crowd ("mean shift"): every dot walks uphill to the busiest spot near it, and the dots
// that end on the same spot form a group. `reach` is how far a dot looks around (in map units, the map is 1 wide).
function crowds(spots, reach) {
  // The dots are sorted into square cells as big as the distance a dot looks around, so each look only needs
  // the 9 cells around it instead of every dot.
  const look = reach * 2.5;
  const cells = new Map();
  const cellKey = (cx, cy) => cx * 65536 + cy;
  spots.forEach((spot, index) => {
    const key = cellKey(Math.floor(spot.x / look), Math.floor(spot.y / look));
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(index);
  });
  const peaks = spots.map(spot => {
    let { x, y } = spot;
    let weight = 0;
    for (let round = 0; round < 30; round++) {
      let sx = 0;
      let sy = 0;
      weight = 0;
      const cx = Math.floor(x / look);
      const cy = Math.floor(y / look);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          for (const index of cells.get(cellKey(gx, gy)) ?? []) {
            const other = spots[index];
            const d2 = (other.x - x) ** 2 + (other.y - y) ** 2;
            if (d2 > look * look) continue;
            const w = Math.exp(-d2 / (2 * reach * reach));
            sx += other.x * w;
            sy += other.y * w;
            weight += w;
          }
        }
      }
      if (!weight) break;
      const moved = Math.hypot(sx / weight - x, sy / weight - y);
      x = sx / weight;
      y = sy / weight;
      if (moved < reach * 0.01) break;
    }
    return { x, y, weight };
  });
  // Peaks that ended close together are the same peak. The busiest ones are settled first (a fixed order).
  const order = peaks.map((_, index) => index).sort((a, b) => peaks[b].weight - peaks[a].weight || a - b);
  const groups = [];
  for (const index of order) {
    const peak = peaks[index];
    let group = groups.find(g => Math.hypot(g.x - peak.x, g.y - peak.y) < reach * 0.6);
    if (!group) groups.push((group = { x: peak.x, y: peak.y, members: [] }));
    group.members.push(spots[index]);
  }
  return groups.sort((a, b) => b.members.length - a.members.length);
}

const round = value => Math.round(value * 1e5) / 1e5;

// Topic names: the tag that tells a group apart best. A tag most of the group shares but few other links have
// beats a tag that half the library has ("Open Source"). Groups are found on the settled map, where they are clear
// knots; the name is placed later, in the middle of the same dots after they have spread out (see `.final`).
function topicNames(spots, reach, smallest, level) {
  const used = new Map(); // how many links have each tag
  for (const spot of spots) for (const tag of new Set(spot.tags)) used.set(tag, (used.get(tag) ?? 0) + 1);
  const names = [];
  for (const group of crowds(spots, reach)) {
    const size = group.members.length;
    if (size < smallest) continue;
    const here = new Map();
    for (const spot of group.members) for (const tag of new Set(spot.tags)) here.set(tag, (here.get(tag) ?? 0) + 1);
    let best = null;
    let bestScore = 0;
    for (const [tag, count] of here) {
      if (count < 2 || count < size * 0.3) continue;
      const score = (count / size) * Math.log(1 + spots.length / used.get(tag));
      if (score > bestScore || (score === bestScore && best && tag < best)) {
        best = tag;
        bestScore = score;
      }
    }
    if (best) names.push({ text: best, members: group.members, count: size, level });
  }
  return names;
}

// ---------- Step 5: spread the dots out ----------

// Settling leaves tight knots and long gaps. Here the dots shuffle apart, a little each round, like a crowd in a
// square: two dots closer than the wanted distance push each other away, and the distance they want grows slowly, so
// a knot opens up gently and its dots stay in the same order. Three more small rules keep the map meaningful:
// - tied dots that drift too far apart pull back together, so neighbours stay neighbours;
// - dots of different categories want a little more room than dots of the same one, so categories keep clean borders;
// - everything is pulled softly toward the middle, so the gaps close and the land fills the map instead of the sea.
// Dots look only at the cells around them, so a round is quick even for 2,000 dots.
async function spreadOut(placed, aspect, edges, groups, spacing) {
  const n = placed.length;
  const x = Float64Array.from(placed, point => point[0]);
  // Stretched a little toward the shape of a screen (only part of the way, so nothing gets badly squashed).
  const stretch = (SHAPE / aspect) ** 0.7;
  const y = Float64Array.from(placed, point => point[1] * aspect * stretch);
  const middleY = (aspect * stretch) / 2;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const random = seeded(SEED + 1);
  const tied = edges.filter(([, , weight]) => weight > 0.15);
  // Some dots want more room than others, so the dots don't end up in neat rows like an orchard.
  const elbow = Float64Array.from({ length: n }, () => 0.72 + random() * 0.56);
  // The dots are sorted into cells again each round: `first` holds each cell's first dot, `next` the rest of its line.
  const first = new Map();
  const next = new Int32Array(n);
  const cellKey = (cx, cy) => (cx + 4096) * 16384 + (cy + 4096);

  for (let turn = 0; turn < SPREAD_ROUNDS; turn++) {
    const progress = (turn + 1) / SPREAD_ROUNDS;
    const wanted = spacing * (0.3 + 0.7 * Math.min(1, progress * 1.5));
    const reach = wanted * 1.28 * 1.15; // the most room any pair wants: the size of a cell
    first.clear();
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      const key = cellKey(Math.floor(x[i] / reach), Math.floor(y[i] / reach));
      next[i] = first.get(key) ?? -1;
      first.set(key, i);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / reach);
      const cy = Math.floor(y[i] / reach);
      for (let ax = cx - 1; ax <= cx + 1; ax++) {
        for (let ay = cy - 1; ay <= cy + 1; ay++) {
          for (let j = first.get(cellKey(ax, ay)) ?? -1; j >= 0; j = next[j]) {
            if (j <= i) continue;
            // Dots of different categories keep a little more distance, for clean borders.
            const room = wanted * ((elbow[i] + elbow[j]) / 2) * (groups[i] === groups[j] ? 1 : 1.15);
            let dx = x[i] - x[j];
            let dy = y[i] - y[j];
            let d = Math.hypot(dx, dy);
            if (d >= room) continue;
            if (d < 1e-7) {
              // Exactly on the same spot (a link saved twice): any direction will do.
              const angle = random() * Math.PI * 2;
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              d = 1;
              const push = room * 0.25;
              fx[i] += dx * push;
              fy[i] += dy * push;
              fx[j] -= dx * push;
              fy[j] -= dy * push;
              continue;
            }
            const push = ((room - d) / d) * 0.32;
            fx[i] += dx * push;
            fy[i] += dy * push;
            fx[j] -= dx * push;
            fy[j] -= dy * push;
          }
        }
      }
    }
    // Neighbours that have drifted more than a few steps apart pull back toward each other.
    const leash = spacing * 2.6;
    for (const [a, b, weight] of tied) {
      const dx = x[a] - x[b];
      const dy = y[a] - y[b];
      const d = Math.hypot(dx, dy);
      if (d <= leash || d === 0) continue;
      const pull = ((d - leash) / d) * 0.012 * weight;
      fx[a] -= dx * pull;
      fy[a] -= dy * pull;
      fx[b] += dx * pull;
      fy[b] += dy * pull;
    }
    for (let i = 0; i < n; i++) {
      // Softly toward the middle: strong enough to close the gaps, too weak to undo the elbow room.
      x[i] += fx[i] + (0.5 - x[i]) * GRAVITY;
      y[i] += fy[i] + (middleY - y[i]) * GRAVITY;
    }
    await breathe();
  }
  return { x, y };
}

// Scales the spread-out dots to fill the map, with room around them for the land's edge. A very lonely dot is brought
// in to the edge so it doesn't shrink everything else. Gives y as the server has always sent it: 0 at the bottom, 1 at the top.
function fillMap({ x, y }, margin) {
  const n = x.length;
  const edgesOf = values => {
    const sorted = Float64Array.from(values).sort();
    return [sorted[Math.floor((n - 1) * 0.003)], sorted[Math.ceil((n - 1) * 0.997)]];
  };
  const [x0, x1] = edgesOf(x);
  const [y0, y1] = edgesOf(y);
  const scale = (1 - margin * 2) / (Math.max(x1 - x0, 1e-6));
  const aspect = gridAspect((y1 - y0) * scale + margin * 2);
  const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
  // The dots are centered top to bottom, in case rounding the shape to whole squares changed the height a little.
  const offsetY = (aspect - (y1 - y0) * scale) / 2;
  const points = [];
  for (let i = 0; i < n; i++) {
    const px = margin + (clamp(x[i], x0, x1) - x0) * scale;
    const py = offsetY + (clamp(y[i], y0, y1) - y0) * scale;
    points.push([px, py / aspect]);
  }
  return { points, aspect };
}

// ---------- Putting it together ----------

// Everything the map needs from the rows: where each dot goes is worked out from the fingerprints.
function mapPoint(row, near, x, y, hub) {
  const point = { id: row.id, title: row.title, category: row.category, x: round(x), y: round(y) };
  if (near) point.near = near;
  if (hub) point.hub = 1;
  if (row.icon) point.icon = row.icon;
  if (row.source === 'github') point.gh = 1;
  return point;
}

// The tags that say most about a category's links (not its own name again).
function topTags(rows) {
  const count = new Map();
  for (const row of rows) for (const tag of new Set(row.tags ?? [])) count.set(tag, (count.get(tag) ?? 0) + 1);
  return [...count]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 6)
    .map(([tag]) => tag);
}

// rows: [{ id, title, category, tags, icon, source, fingerprint: [384 numbers] }] → the map. Exported for testing.
export async function buildMap(rows) {
  const n = rows.length;
  if (n < 4) {
    // Too few links to learn anything from: put them in a row.
    const aspect = gridAspect(0.6);
    const points = rows.map((row, i) => mapPoint(row, [], (i + 1) / (n + 1), 0.5));
    return await withLand(rows, points, aspect, 0.09, new Int32Array(n), []);
  }
  const vectors = unitVectors(rows.map(row => row.fingerprint));
  const k = Math.min(GRAPH_K, n - 1);
  const closest = await closestLinks(vectors, n, k);
  const categories = rows.map(row => row.category);
  const edges = ties(closest, n, k, categories);
  const xy = await settle(firstPicture(vectors, n), edges, n);
  const { points: settled, aspect: settledAspect } = fitToBox(xy, n);

  // Names of the groups, found while the groups are still clear knots.
  const spots = rows.map((row, i) => ({ x: settled[i][0], y: settled[i][1] * settledAspect, i, tags: row.tags ?? [] }));
  const groups = [...topicNames(spots, 0.03, 5, 1), ...topicNames(spots, 0.012, 3, 2)];

  // Each dot's share of the map decides how far apart the dots want to be.
  const spacing = Math.min(0.09, Math.sqrt((SHAPE * FILL) / n));
  const spread = await spreadOut(settled, settledAspect, edges, categories, spacing);
  const margin = Math.max(0.035, spacing * 1.6);
  const { points: placed, aspect } = fillMap(spread, margin);

  // How many other links have each link among their closest: the ones most have are the "towns" of the map.
  const hubScore = new Int32Array(n);
  for (let i = 0; i < closest.who.length; i++) if (closest.who[i] >= 0) hubScore[closest.who[i]]++;
  const hubLine = Int32Array.from(hubScore).sort()[Math.floor(n * (1 - BIG_HUBS))];

  const points = rows.map((row, i) => {
    const near = [];
    for (let s = 0; s < Math.min(NEAR, k); s++) {
      const value = closest.alike[i * k + s];
      if (closest.who[i * k + s] < 0 || (value < NEAR_MIN && s >= 3)) break;
      near.push(closest.who[i * k + s], Math.round(value * 100));
    }
    return mapPoint(row, near, placed[i][0], placed[i][1], hubScore[i] >= Math.max(hubLine, 2));
  });
  // A group's name goes in the middle of its dots, where they are now.
  const topics = groups.map(({ text, members, count, level }) => {
    let x = 0;
    let y = 0;
    for (const { i } of members) {
      x += placed[i][0];
      y += placed[i][1];
    }
    return { text, x: round(x / members.length), y: round(y / members.length), count, level };
  });
  await breathe();
  return await withLand(rows, points, aspect, spacing, hubScore, topics);
}

// Adds the land around the dots, and the names of the categories on it.
async function withLand(rows, points, aspect, spacing, hubScore, topics) {
  const { land, home, regions } = await buildLand(
    points.map(point => ({ x: point.x, y: (1 - point.y) * aspect, category: point.category })),
    aspect,
    spacing,
    breathe,
  );
  return { points, aspect, islands: islandList(rows, regions, hubScore, aspect), topics, land, home };
}

// One name per category, on its main land (see land.js), with what the side card shows about it: its number of links,
// its top tags, its most connected links, and the part of the map to show (`box`: left, top, right, bottom, with y
// counted down from the top of the map). Biggest first. x and y are like a dot's: y is 0 at the bottom and 1 at the top.
function islandList(rows, regions, hubScore, aspect) {
  const groups = Map.groupBy(rows.map((row, i) => ({ row, i })), ({ row }) => row.category);
  return [...groups]
    .map(([name, members]) => {
      const region = regions.get(name);
      return {
        name,
        x: region.x,
        y: round(1 - region.y / aspect),
        box: region.box,
        count: members.length,
        tags: topTags(members.map(({ row }) => row)),
        // Most connected first. (How often you opened them is added fresh for each visit: see withLiveSizes.)
        links: members.map(({ i }) => i).sort((a, b) => hubScore[b] - hubScore[a] || a - b),
      };
    })
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

async function freshMap(key) {
  // A server that just woke up (Render puts it to sleep when nobody visits for a while) finds the last map it
  // built in the database, so it doesn't have to build the same map again.
  try {
    const saved = JSON.parse((await getMeta(SAVED)) ?? 'null');
    if (saved?.key === key) {
      cache = { key, map: saved.map };
      return saved.map;
    }
  } catch (err) {
    console.error('Could not read the saved map:', err.message);
  }

  const { rows } = await query(
    `SELECT id, title, category, tags, icon_url AS icon, source, embedding::text AS embedding FROM links WHERE embedding IS NOT NULL
     ORDER BY created_at DESC, id LIMIT ${MAX_DOTS}`,
  );
  // Read each fingerprint and drop its text right away, so a big library doesn't hold both in memory.
  const items = rows.map(row => {
    const fingerprint = JSON.parse(row.embedding);
    row.embedding = null;
    return { id: row.id, title: row.title, category: row.category, tags: row.tags, icon: row.icon, source: row.source, fingerprint };
  });
  const map = await buildMap(items);
  cache = { key, map };
  setMeta(SAVED, JSON.stringify({ key, map })).catch(err => console.error('Could not save the map:', err.message));
  query("DELETE FROM meta WHERE key = 'map-v1'").catch(() => {}); // the saved map of the version before this one
  return map;
}

// The map as it was last built (or built now, if a link changed since).
async function savedMap() {
  // Anything that moves a dot or changes its name, color, picture or topic makes a new map. (`hashtext` notices a new
  // category or tag on any link without reading them all.)
  const { rows: [state] } = await query(
    `SELECT count(*)::int AS n, max(updated_at)::text AS changed,
            coalesce(sum(hashtext(concat_ws('|', title, category, icon_url, source, array_to_string(tags, ',')))), 0)::text AS names
     FROM links WHERE embedding IS NOT NULL`,
  );
  const key = `${SAVED}:${state.n}:${state.changed}:${state.names}`;
  if (cache.key === key) return cache.map;
  if (building?.key !== key) {
    const job = freshMap(key).finally(() => {
      if (building === job) building = null;
    });
    building = Object.assign(job, { key });
  }
  return building;
}

// How big a dot is drawn, and which links an island shows first, depend on what you open and star. That changes all the
// time but moves nothing, so it isn't part of the saved map: it's read fresh, and only worked out again when it changed.
let sized = { map: null, opened: '', data: null };
async function withLiveSizes(map) {
  const { rows } = await query('SELECT id, opens, favorite FROM links WHERE embedding IS NOT NULL AND (opens > 0 OR favorite)');
  const opened = rows.map(row => `${row.id}:${row.opens}:${row.favorite ? 1 : 0}`).sort().join();
  if (sized.map === map && sized.opened === opened) return sized.data;
  const live = new Map(rows.map(row => [row.id, row]));
  const points = map.points.map(({ hub, ...point }) => {
    const seen = live.get(point.id);
    // 2 = a city: a favorite or a link you often open. 1 = a town: opened now and then, or close to many other links.
    const size = seen ? (seen.favorite || seen.opens >= OFTEN_OPENED ? 2 : 1) : hub ? 1 : 0;
    return size ? { ...point, size } : point;
  });
  const score = index => {
    const seen = live.get(map.points[index].id);
    return seen ? (seen.favorite ? 1000 : 0) + seen.opens : 0;
  };
  const islands = map.islands.map(({ links, ...island }) => ({
    ...island,
    // Favorites and the most opened first; the rest stay in their order (most connected first).
    top: [...links].sort((a, b) => score(b) - score(a)).slice(0, TOP_LINKS),
  }));
  const { home, ...rest } = map;
  sized = { map, opened, data: { ...rest, points, islands } };
  return sized.data;
}

// The whole map for the Explore page: dots, each one's closest links, the land, and the names to show at each zoom level.
export async function libraryMap() {
  return withLiveSizes(await savedMap());
}

// The home page's small map only needs the dots, the land (in less detail) and the island names: no neighbours, no
// topics, so it stays quick to load.
let small = { map: null, data: null };
export async function homeMap() {
  const map = await savedMap();
  if (small.map !== map) {
    const points = map.points.map(({ id, title, category, x, y }) => ({ id, title, category, x, y }));
    const islands = map.islands.map(({ name, x, y, count }) => ({ name, x, y, count }));
    small = { map, data: { points, islands, aspect: map.aspect, land: map.home } };
  }
  return small.data;
}
