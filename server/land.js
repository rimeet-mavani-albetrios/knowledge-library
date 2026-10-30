// The land of the knowledge map: coasts, countries and height lines, worked out from where the dots are.
//
// Think of every dot as a small hill. Add all the hills up on a grid of about 260 × 170 squares and you get a height
// for every square. Where the height is above "sea level" there is land, so nearby dots melt together into islands and
// continents, and a lonely dot gets its own little islet. Do the same per category and every square of land belongs to
// the category that is strongest there: those are the countries, and two neighbours share one clean border.
//
// `contours` from d3-contour draws the line where a height crosses a level (the same way a hiking map is made).
// Before that, every square's position is nudged a little by a fixed "noise", so coasts and borders get bays and
// capes like real ones instead of looking like soft blobs. Same dots in → same land out: nothing here is random.
//
// It's all arithmetic on a few small lists: about 100 ms for 1,000 links and a few megabytes of memory, it stops for a
// breath now and then, and it only runs when the map is built again (see map.js).
import { contours } from 'd3-contour';

const CELLS_ACROSS = 260; // squares across the map
const SEA_LEVEL = 0.34; // a lone dot's hill is 1 high, so every dot stands on land
const HILL = 0.66; // how wide a dot's hill is, × the usual distance between dots
const TERRITORY = 1.55; // a category's hills are this much wider than the land's, so borders are calm and tiny enclaves rare
const OVERLAP = 0.45; // how far a country reaches over its borders (in hill heights)
const SMALLEST_RING = 3.5; // smaller bits of land or country than this many squares are left out (crumbs)
const NUDGE = [
  // [size of the wave in squares, how far it pushes in squares]: a slow one for the big shapes, quick ones for detail.
  // Added up they stay below a lone dot's islet, so no dot is ever pushed off its land.
  [22, 2.0],
  [11, 1.5],
  [5, 0.8],
];
// The coast also rises and falls a little, for small bays and capes. Dots stay on land: a dot's own hill is 1 high,
// and even the deepest dip leaves it well above sea level.
const COAST_WAVES = [
  [13, 0.26],
  [6, 0.17],
  [3, 0.08],
];
const SEED = 20261030;

// Paths are written in whole numbers: 4,000 across the map for Explore (sharp even when you zoom in a lot),
// 1,000 for the small map on the home page (which is drawn small and should stay quick to load).
export const LAND_SCALE = 4000;
export const HOME_SCALE = 1000;

// The map's height ÷ width is rounded to a whole number of squares, so a square is exactly as tall as it is wide.
export const gridHeight = aspect => Math.max(40, Math.round(CELLS_ACROSS * aspect));
export const gridAspect = aspect => gridHeight(aspect) / CELLS_ACROSS;

// ---------- The nudge: smooth "noise" that is the same every time ----------

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

// A smooth wavy surface: random numbers on a coarse net, blended smoothly in between ("value noise").
function waves(width, height, size, random) {
  const across = Math.ceil(width / size) + 2;
  const down = Math.ceil(height / size) + 2;
  const net = new Float32Array(across * down);
  for (let i = 0; i < net.length; i++) net[i] = random() * 2 - 1;
  const fade = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const gx = x / size;
    const gy = y / size;
    const cx = Math.floor(gx);
    const cy = Math.floor(gy);
    const u = fade(gx - cx);
    const v = fade(gy - cy);
    const at = (a, b) => net[b * across + a];
    return (
      (at(cx, cy) * (1 - u) + at(cx + 1, cy) * u) * (1 - v) +
      (at(cx, cy + 1) * (1 - u) + at(cx + 1, cy + 1) * u) * v
    );
  };
}

// Where each square "really" is, after the nudge.
function nudgedSquares(width, height) {
  const random = seeded(SEED);
  const layers = NUDGE.map(([size, push]) => ({ push, dx: waves(width, height, size, random), dy: waves(width, height, size, random) }));
  const nx = new Float32Array(width * height);
  const ny = new Float32Array(width * height);
  let reach = 0;
  for (const { push } of layers) reach += push;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ox = 0;
      let oy = 0;
      for (const { push, dx, dy } of layers) {
        ox += dx(x, y) * push;
        oy += dy(x, y) * push;
      }
      nx[y * width + x] = x + ox;
      ny[y * width + x] = y + oy;
    }
  }
  return { nx, ny, reach };
}

// ---------- The hills ----------

// Adds one dot's hill (a soft bump, `sigma` squares wide) to a field of heights.
function addHill(field, width, height, squares, gx, gy, sigma) {
  const { nx, ny, reach } = squares;
  const radius = sigma * 3.1 + reach;
  const left = Math.max(0, Math.floor(gx - radius));
  const right = Math.min(width - 1, Math.ceil(gx + radius));
  const top = Math.max(0, Math.floor(gy - radius));
  const bottom = Math.min(height - 1, Math.ceil(gy + radius));
  const wide = 2 * sigma * sigma;
  const far = (sigma * 3.1) ** 2;
  for (let y = top; y <= bottom; y++) {
    const row = y * width;
    for (let x = left; x <= right; x++) {
      const dx = nx[row + x] - gx;
      const dy = ny[row + x] - gy;
      const d2 = dx * dx + dy * dy;
      if (d2 < far) field[row + x] += Math.exp(-d2 / wide);
    }
  }
}

// ---------- From a height map to a compact path ----------

// The area of a ring (in squares); positive for an outer edge, negative for a hole.
function ringArea(ring) {
  let sum = 0;
  for (let i = 0, last = ring.length - 1; i < ring.length; last = i++) sum += ring[last][0] * ring[i][1] - ring[i][0] * ring[last][1];
  return sum / 2;
}

// Keeps the points that matter for the shape and drops the rest, to keep the data small.
// every: keep at least one point in so many squares. turn: always keep a point where the line bends this much.
function thinned(ring, every, turn) {
  const n = ring.length - 1; // a ring ends on the point it started with
  const kept = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = ring[i];
    const [ax, ay] = ring[(i - 1 + n) % n];
    const [bx, by] = ring[(i + 1) % n];
    const ux = x - ax;
    const uy = y - ay;
    const vx = bx - x;
    const vy = by - y;
    const bend = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
    if (bend > turn || (Math.floor(x) + Math.floor(y)) % every === 0) kept.push(ring[i]);
  }
  return kept;
}

// Numbers next to each other in a path need a space between them, unless the next one starts with a minus.
function joined(numbers) {
  let text = '';
  numbers.forEach((value, i) => {
    text += i > 0 && value >= 0 ? ` ${value}` : `${value}`;
  });
  return text;
}

// Turns the rings of a contour into one short path: "M x y l dx dy dx dy … z", in whole numbers.
function toPath(shape, squareSize, { every, turn, smallest = SMALLEST_RING }) {
  let path = '';
  for (const polygon of shape.coordinates) {
    if (Math.abs(ringArea(polygon[0])) < smallest) continue;
    for (const ring of polygon) {
      if (Math.abs(ringArea(ring)) < smallest) continue;
      const points = thinned(ring, every, turn);
      if (points.length < 3) continue;
      const startX = Math.round(points[0][0] * squareSize);
      const startY = Math.round(points[0][1] * squareSize);
      let x = startX;
      let y = startY;
      const moves = [];
      for (let i = 1; i < points.length; i++) {
        const nextX = Math.round(points[i][0] * squareSize);
        const nextY = Math.round(points[i][1] * squareSize);
        if (nextX === x && nextY === y) continue;
        moves.push(nextX - x, nextY - y);
        x = nextX;
        y = nextY;
      }
      if (moves.length >= 4) path += `M${startX} ${startY}l${joined(moves)}z`;
    }
  }
  return path;
}

// ---------- Which squares belong together, and where the name goes ----------

// Groups the squares of each owner into connected pieces, and gives every piece its size and edges.
function piecesOf(owner, width, height) {
  const pieceOf = new Int32Array(owner.length).fill(-1);
  const pieces = [];
  const stack = [];
  for (let start = 0; start < owner.length; start++) {
    if (owner[start] < 0 || pieceOf[start] >= 0) continue;
    const piece = { owner: owner[start], squares: [], dots: 0, left: width, right: 0, top: height, bottom: 0 };
    const id = pieces.length;
    pieces.push(piece);
    pieceOf[start] = id;
    stack.push(start);
    while (stack.length) {
      const at = stack.pop();
      const x = at % width;
      const y = (at - x) / width;
      piece.squares.push(at);
      piece.left = Math.min(piece.left, x);
      piece.right = Math.max(piece.right, x);
      piece.top = Math.min(piece.top, y);
      piece.bottom = Math.max(piece.bottom, y);
      const visit = next => {
        if (owner[next] === piece.owner && pieceOf[next] < 0) {
          pieceOf[next] = id;
          stack.push(next);
        }
      };
      if (x > 0) visit(at - 1);
      if (x < width - 1) visit(at + 1);
      if (y > 0) visit(at - width);
      if (y < height - 1) visit(at + width);
    }
  }
  return { pieceOf, pieces };
}

// How far each square of a piece is from the piece's edge (a quick two-pass distance sweep). Steps up and down count
// more than steps left and right, because a name is much wider than it is tall: a spot with room left and right wins.
function roomInside(piece, pieceOf, id, width) {
  const { left, right, top, bottom } = piece;
  const w = right - left + 1;
  const h = bottom - top + 1;
  const room = new Float32Array(w * h);
  const inside = (x, y) => pieceOf[y * width + x] === id;
  const across = 1;
  const down = 2.6;
  const slant = Math.hypot(across, down);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x + left, y + top)) continue;
      const a = x > 0 ? room[y * w + x - 1] : 0;
      const b = y > 0 ? room[(y - 1) * w + x] : 0;
      const c = x > 0 && y > 0 ? room[(y - 1) * w + x - 1] : 0;
      const d = x < w - 1 && y > 0 ? room[(y - 1) * w + x + 1] : 0;
      room[y * w + x] = Math.min(a + across, b + down, c + slant, d + slant);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      if (!inside(x + left, y + top)) continue;
      const a = x < w - 1 ? room[y * w + x + 1] : 0;
      const b = y < h - 1 ? room[(y + 1) * w + x] : 0;
      const c = x < w - 1 && y < h - 1 ? room[(y + 1) * w + x + 1] : 0;
      const d = x > 0 && y < h - 1 ? room[(y + 1) * w + x - 1] : 0;
      room[y * w + x] = Math.min(room[y * w + x], a + across, b + down, c + slant, d + slant);
    }
  }
  return { room, w };
}

// The best spot for a name in a piece of land: as far from the coast as possible (a name is wider than tall, so room
// left and right counts most) and, when there's a choice, where few dots stand. A name on a crowd of dots is hard to read.
function nameSpot(piece, pieceOf, id, width, dotsAt) {
  const { room, w } = roomInside(piece, pieceOf, id, width);
  let best = piece.squares[0];
  let bestScore = -Infinity;
  for (const square of piece.squares) {
    const x = square % width;
    const y = (square - x) / width;
    const here = room[(y - piece.top) * w + (x - piece.left)];
    // The most room counts most, so the name sits in the middle of the land; a few dots under it cost a little room.
    const score = here - dotsAt(x, y) * 0.6;
    if (score > bestScore) {
      bestScore = score;
      best = square;
    }
  }
  const x = best % width;
  return { x: x + 0.5, y: (best - x) / width + 0.5 };
}

// ---------- Putting it together ----------

// dots: [{ x, y, category }] with x from 0 to 1 and y from 0 to `aspect`, going down. spacing: the usual distance
// between dots, in the same units. breathe: gives other visitors a turn. Gives the paths for Explore and the home page,
// and each category's main land.
export async function buildLand(dots, aspect, spacing, breathe = async () => {}) {
  const width = CELLS_ACROSS;
  const height = gridHeight(aspect);
  const squareSize = LAND_SCALE / width;
  const homeSize = HOME_SCALE / width;
  const toGrid = dot => ({ gx: dot.x * width - 0.5, gy: (dot.y / aspect) * height - 0.5 });
  const sigma = Math.max(1.6, spacing * HILL * width);
  const squares = nudgedSquares(width, height);

  const names = [...new Set(dots.map(dot => dot.category))];
  const number = new Map(names.map((name, i) => [name, i]));
  const total = new Float32Array(width * height);
  const wideTotal = new Float32Array(width * height);
  const each = names.map(() => new Float32Array(width * height));
  for (const dot of dots) {
    const { gx, gy } = toGrid(dot);
    addHill(total, width, height, squares, gx, gy, sigma);
    addHill(each[number.get(dot.category)], width, height, squares, gx, gy, sigma * TERRITORY);
    addHill(wideTotal, width, height, squares, gx, gy, sigma * 3);
  }

  // The strongest category on each square, how strong it is, and how strong the next one is.
  const who = new Int16Array(width * height).fill(-1);
  const owner = new Int16Array(width * height).fill(-1);
  const strongest = new Float32Array(width * height);
  const second = new Float32Array(width * height);
  for (let i = 0; i < owner.length; i++) {
    let first = -Infinity;
    let next = -Infinity;
    let top = -1;
    for (let c = 0; c < each.length; c++) {
      const value = each[c][i];
      if (value > first) {
        next = first;
        first = value;
        top = c;
      } else if (value > next) next = value;
    }
    who[i] = top;
    strongest[i] = first;
    second[i] = next === -Infinity ? 0 : next;
  }

  // The rise and fall of the coast. Only matters near sea level; further inland the land stays as it is.
  const random = seeded(SEED + 7);
  const coastWaves = COAST_WAVES.map(([size, amount]) => ({ amount, wave: waves(width, height, size, random) }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (total[i] < SEA_LEVEL * 0.4 || total[i] > SEA_LEVEL * 3) continue;
      let change = 1;
      for (const { amount, wave } of coastWaves) change += wave(x, y) * amount;
      total[i] *= change;
    }
  }
  // Who owns each square of land: the category that is strongest there. Below sea level nobody does.
  for (let i = 0; i < owner.length; i++) if (total[i] >= SEA_LEVEL) owner[i] = who[i];
  const shape = contours().size([width, height]);
  const coastShape = shape.contour(total, SEA_LEVEL);
  // A country's edge: it's the strongest here (the difference with the strongest other is above 0), AND this is land
  // (the height is above sea level). The two are put on about the same scale, so the line runs smoothly from a border
  // into the coast. Each country reaches a little over its borders (OVERLAP), and the countries are painted biggest
  // first, each with its own outline. So where they overlap, the later one simply covers the earlier one's edge: one
  // clean line per border, and no gaps where three countries meet, however far you zoom in.
  const field = new Float32Array(width * height);
  const countryShapes = [];
  for (let c = 0; c < names.length; c++) {
    const mine = each[c];
    for (let i = 0; i < field.length; i++) {
      const other = who[i] === c ? second[i] : strongest[i];
      field[i] = Math.min(mine[i] - other + OVERLAP, (total[i] - SEA_LEVEL) * 2);
    }
    countryShapes.push(shape.contour(field, 0));
    await breathe();
  }

  // Height lines: three levels that split the land into even parts, whatever the shape of the library.
  const landHeights = [];
  for (let i = 0; i < total.length; i++) if (total[i] >= SEA_LEVEL) landHeights.push(wideTotal[i]);
  landHeights.sort((a, b) => a - b);
  const levels = [0.3, 0.58, 0.82].map(share => landHeights[Math.floor(share * (landHeights.length - 1))] ?? Infinity);
  // (Each line stays on land: where the land ends, the line runs along the coast and is hidden by it.)
  const heightShapes = levels.map(level => {
    for (let i = 0; i < field.length; i++) field[i] = Math.min(wideTotal[i], level + (total[i] - SEA_LEVEL) * 3);
    return shape.contour(field, level);
  });

  // Each category's main land: its biggest piece (by dots), where its name goes, and the part of the map to show when
  // you pick it: the pieces that hold most of its dots, so one far-off dot doesn't zoom the whole map out.
  const { pieceOf, pieces } = piecesOf(owner, width, height);
  const dotCount = new Uint16Array(width * height);
  const dotsOf = names.map(() => []);
  for (const dot of dots) {
    const { gx, gy } = toGrid(dot);
    const x = Math.min(width - 1, Math.max(0, Math.round(gx)));
    const y = Math.min(height - 1, Math.max(0, Math.round(gy)));
    dotCount[y * width + x]++;
    dotsOf[number.get(dot.category)].push(dot);
    const id = pieceOf[y * width + x];
    if (id >= 0 && pieces[id].owner === number.get(dot.category)) pieces[id].dots++;
  }
  // Dots around a square, in a box as wide as a name (for choosing a spot with fewer dots under the name).
  const dotsAt = (x, y) => {
    let sum = 0;
    for (let b = Math.max(0, y - 2); b <= Math.min(height - 1, y + 2); b++) {
      for (let a = Math.max(0, x - 9); a <= Math.min(width - 1, x + 9); a++) sum += dotCount[b * width + a];
    }
    return sum;
  };
  const regions = new Map();
  names.forEach((name, c) => {
    const mine = pieces.map((piece, id) => ({ piece, id })).filter(item => item.piece.owner === c);
    // A category with no land of its own (all its dots stand inside bigger neighbours) is named at the middle of its dots.
    const members = dotsOf[c];
    const middle = {
      x: members.reduce((sum, dot) => sum + dot.x, 0) / members.length,
      y: members.reduce((sum, dot) => sum + dot.y, 0) / members.length,
    };
    const toMapX = x => Math.round((x / width) * 1e5) / 1e5;
    const toMapY = y => Math.round(((y / height) * aspect) * 1e5) / 1e5;
    // Most dots first, then most land.
    mine.sort((a, b) => b.piece.dots - a.piece.dots || b.piece.squares.length - a.piece.squares.length);
    const main = mine[0];
    const spot = main && main.piece.squares.length >= 6 ? nameSpot(main.piece, pieceOf, main.id, width, dotsAt) : null;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    let covered = 0;
    for (const { piece } of mine) {
      box[0] = Math.min(box[0], piece.left);
      box[1] = Math.min(box[1], piece.top);
      box[2] = Math.max(box[2], piece.right + 1);
      box[3] = Math.max(box[3], piece.bottom + 1);
      covered += piece.dots;
      if (covered >= members.length * 0.8) break;
    }
    regions.set(name, {
      x: spot ? toMapX(spot.x) : Math.round(middle.x * 1e5) / 1e5,
      y: spot ? toMapY(spot.y) : Math.round(middle.y * 1e5) / 1e5,
      box: main ? [toMapX(box[0]), toMapY(box[1]), toMapX(box[2]), toMapY(box[3])] : null,
    });
  });

  const fine = { every: 2, turn: 0.3 };
  const rough = { every: 3, turn: 0.75, smallest: 5 };
  // Biggest first, so a small country inside a big one is painted on top of it.
  const order = names.map((_, c) => c).sort((a, b) => dotsOf[b].length - dotsOf[a].length || (names[a] < names[b] ? -1 : 1));
  const land = {
    scale: LAND_SCALE,
    coast: toPath(coastShape, squareSize, fine),
    countries: order.map(c => ({ category: names[c], d: toPath(countryShapes[c], squareSize, fine) })).filter(country => country.d),
    heights: heightShapes.map(item => toPath(item, squareSize, { every: 3, turn: 0.45, smallest: 14 })),
  };
  const home = {
    scale: HOME_SCALE,
    coast: toPath(coastShape, homeSize, rough),
    countries: order.map(c => ({ category: names[c], d: toPath(countryShapes[c], homeSize, rough) })).filter(country => country.d),
  };
  return { land, home, regions };
}
