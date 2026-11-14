// What is drawn above Sigma's dots, on a plain 2D canvas: the names and the websites' logos.
//
// Names by zoom: far out one name per island (category), closer in the topics inside it, close up the name of each link.
// The most important names are placed first (the picked link, its closest links, search results, then bigger islands
// before smaller ones). A name that would cover one already placed is left out, so names never overlap. A name that is
// already showing goes before an equal new one, and names fade in and out, so nothing flickers while you move.
//
// Logos: other websites' pictures can't be uploaded to WebGL (the browser forbids it), but a 2D canvas may draw them. So
// when you are zoomed in close, each dot gets the website's logo on a small round plate here. They load only for what is
// on screen, at most about 60 at a time. A logo that won't load is remembered, and that dot simply stays a dot.
//
// Writing text with an outline is slow, far too slow to do for every name in every frame. So each name (and each plate) is
// drawn once on its own small picture, and a frame only places those pictures: very quick, however many there are.
import { badIcons } from '../LinkCard.jsx';
import { rgba } from './colors.js';

const MOST_PICTURES = 500; // pictures of names kept at a time; the longest unused ones are dropped
const NEW_PICTURES = 24; // at most this many are drawn in one frame, so moving to a new area stays smooth
const PLATE_PICTURE = 17; // the radius of a plate's picture (× the screen's pixel density); shown at about this size
const NAME_MAX = 32; // longer link names are cut short with "…"
const FADE_MS = 170;
const MOST_LOGOS = 60;
const LOADS_AT_ONCE = 8;
// How close you are is measured the same on every screen (`near` below: 1 is about the whole map on a laptop), because
// what fits around a dot depends on how far apart the dots really are on screen, not on the size of the screen.
const WHOLE_MAP = 1185; // pixels across the map at closeness 1
const LOGOS_FROM = 4.6; // the closeness where logos start to show
const LINK_NAMES_FROM = 3.1; // …and where the names of the links do
const SPACED = '0.9px'; // the air between the letters of topic names, like the names of regions on a printed map
// The GitHub mark, for links to GitHub (the same drawing as GitHubIcon in Icons.jsx).
const GITHUB_MARK =
  'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z';

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
// 0 below `from`, 1 above `to`, a soft S-curve in between (for fading names in and out by zoom).
const ramp = (from, to, value) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const shorten = text => (text.length > NAME_MAX ? `${text.slice(0, NAME_MAX - 1).trimEnd()}…` : text);

// Where names already are, so a new one can check in a moment whether it would cover one.
// The screen is cut into 96px squares; a name only checks the squares it touches.
class TakenSpots {
  constructor() {
    this.cells = new Map();
  }

  each(box, visit) {
    for (let cx = Math.floor(box.l / 96); cx <= Math.floor(box.r / 96); cx++) {
      for (let cy = Math.floor(box.t / 96); cy <= Math.floor(box.b / 96); cy++) if (visit(cx * 4096 + cy) === false) return false;
    }
    return true;
  }

  free(box) {
    return this.each(box, key => !(this.cells.get(key) ?? []).some(o => box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t));
  }

  take(box) {
    this.each(box, key => {
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(box);
    });
  }
}

export class Overlay {
  constructor(canvas, onLogoReady) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onLogoReady = onLogoReady;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.widths = new Map(); // measured name widths (measuring text is slow, and the same names come back)
    this.shown = new Map(); // name key → { alpha, last drawn state }
    this.lastTime = 0;
    this.nameBoxes = []; // where the island names are, for clicks on a name
    this.pictures = new Map(); // name or plate → its small picture
    this.newPictures = 0;
    this.logos = new Map(); // address → { image, ready, since }
    this.loading = 0;
    this.waiting = [];
    this.githubMark = null;
  }

  resize(width, height, dpr) {
    this.w = width;
    this.h = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.pictures.clear();
  }

  // A new theme or new fonts: everything is drawn afresh.
  clearMeasures() {
    this.widths.clear();
    this.pictures.clear();
  }

  // Finds a small picture, or draws it now. Recently used ones stay, the rest make room.
  // Gives null when too many were drawn in this frame already: it comes in the next frame.
  picture(key, draw) {
    let found = this.pictures.get(key);
    if (found) {
      this.pictures.delete(key);
    } else {
      if (this.newPictures >= NEW_PICTURES) return null;
      this.newPictures++;
      found = draw();
      if (this.pictures.size >= MOST_PICTURES) this.pictures.delete(this.pictures.keys().next().value);
    }
    this.pictures.set(key, found);
    return found;
  }

  // A name with its outline, on its own small picture. `pad` is the room around the text for the outline.
  namePicture(label, colors) {
    const halo = label.haloWidth ?? 3.5;
    const fill = rgba(label.fill);
    return this.picture(`n|${label.font}|${label.spaced ? 1 : 0}|${fill}|${halo}|${label.text}`, () => {
      const { dpr } = this;
      const width = this.textWidth(label.font, label.text, label.spaced);
      const size = Number.parseFloat(label.font.split(' ')[1]);
      const pad = Math.ceil(halo / 2) + 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((width + pad * 2) * dpr);
      canvas.height = Math.ceil((size * 1.5 + pad * 2) * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.font = label.font;
      ctx.letterSpacing = label.spaced ? SPACED : '0px';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = halo;
      ctx.strokeStyle = rgba(colors.halo, 0.86);
      const middle = canvas.height / dpr / 2;
      ctx.strokeText(label.text, pad, middle);
      ctx.fillStyle = fill;
      ctx.fillText(label.text, pad, middle);
      return { canvas, width: canvas.width / dpr, height: canvas.height / dpr, pad };
    });
  }

  // A logo on its round plate, on its own small picture.
  platePicture(address, isGithub, hue, entry, colors) {
    return this.picture(`p|${isGithub ? 'github' : address}|${hue.join()}`, () => {
      const { dpr } = this;
      const radius = PLATE_PICTURE * dpr;
      const center = radius + 2 * dpr;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.ceil(center * 2);
      const ctx = canvas.getContext('2d');
      ctx.beginPath();
      ctx.arc(center, center, radius, 0, Math.PI * 2);
      ctx.fillStyle = rgba(colors.plate);
      ctx.fill();
      ctx.lineWidth = 1.6 * dpr;
      ctx.strokeStyle = rgba(hue);
      ctx.stroke();
      const size = radius * 1.32;
      if (isGithub) {
        this.githubMark ??= new Path2D(GITHUB_MARK);
        ctx.save();
        ctx.translate(center - size / 2, center - size / 2);
        ctx.scale(size / 16, size / 16);
        ctx.fillStyle = '#1b1f24';
        ctx.fill(this.githubMark);
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(center, center, radius - dpr, 0, Math.PI * 2);
        ctx.clip();
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(entry.image, center - size / 2, center - size / 2, size, size);
        ctx.restore();
      }
      return { canvas, reach: center / radius };
    });
  }

  textWidth(font, text, spaced = false) {
    const key = `${font}|${text}`;
    let width = this.widths.get(key);
    if (width === undefined) {
      this.ctx.font = font;
      this.ctx.letterSpacing = spaced ? SPACED : '0px';
      width = this.ctx.measureText(text).width;
      if (this.widths.size > 6000) this.widths.clear();
      this.widths.set(key, width);
    }
    return width;
  }

  // The island whose name is at this spot on screen, or null.
  nameAt(x, y) {
    for (const box of this.nameBoxes) if (x >= box.l && x <= box.r && y >= box.t && y <= box.b) return box.category;
    return null;
  }

  // ---------- Logos ----------

  // A logo's picture, once it has loaded. Asking for one that isn't there yet starts loading it.
  logo(address) {
    let entry = this.logos.get(address);
    if (!entry) {
      entry = { image: null, ready: false, since: 0 };
      this.logos.set(address, entry);
      if (!badIcons.has(address)) this.waiting.push({ address, entry });
    }
    return entry.ready ? entry : null;
  }

  loadWaiting() {
    while (this.loading < LOADS_AT_ONCE && this.waiting.length) {
      const { address, entry } = this.waiting.pop(); // the newest first: that's what is on screen now
      this.loading++;
      const image = new Image();
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      image.onload = () => {
        this.loading--;
        entry.image = image;
        entry.ready = image.naturalWidth > 0;
        entry.since = performance.now();
        this.loadWaiting();
        this.onLogoReady();
      };
      image.onerror = () => {
        this.loading--;
        badIcons.add(address);
        this.loadWaiting();
      };
      image.src = address;
    }
  }

  // Places one dot's logo plate. `strength` is lower for dots that recede while something else is picked.
  plate(x, y, radius, hue, address, entry, isGithub, now, colors, strength) {
    const { ctx } = this;
    const age = calm() || !entry ? 1 : clamp((now - entry.since) / 220, 0, 1);
    const found = this.platePicture(address, isGithub, hue, entry, colors);
    if (!found) return true;
    const half = radius * found.reach;
    ctx.globalAlpha = age * strength;
    ctx.drawImage(found.canvas, x - half, y - half, half * 2, half * 2);
    ctx.globalAlpha = 1;
    return age < 1;
  }

  // ---------- A frame ----------

  // state: what the engine knows: the world, its colors, the view, the picked and lit dots, the areas covered by panels.
  // Gives true while something is still fading, so the next frame is drawn too.
  draw(state, now) {
    const { ctx, w, h, dpr } = this;
    const { world, colors, view, focus, near, lit, hover, preview, dotRadius, sx, sy, picked } = state;
    if (!world || !colors || !w) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.newPictures = 0;
    const z = view.k / WHOLE_MAP;
    let busy = false;
    const onScreen = (i, margin = 30) => sx[i] > -margin && sx[i] < w + margin && sy[i] > -margin && sy[i] < h + margin;

    // ---- Faint lines from the dot under the mouse to its closest links ----
    if (hover >= 0 && hover !== focus) {
      ctx.strokeStyle = rgba(colors.hue.get(world.category[hover]) ?? colors.muted, colors.dark ? 0.62 : 0.72);
      ctx.lineWidth = 1.15;
      ctx.lineCap = 'round';
      ctx.beginPath();
      world.near[hover].forEach(({ index }, place) => {
        const x = sx[index];
        const y = sy[index];
        // A gentle curve, like the lines of a picked dot: the bend is sideways from the middle of the line.
        const bend = place % 2 ? 0.1 : -0.1;
        ctx.moveTo(sx[hover], sy[hover]);
        ctx.quadraticCurveTo((sx[hover] + x) / 2 - (y - sy[hover]) * bend, (sy[hover] + y) / 2 + (x - sx[hover]) * bend, x, y);
      });
      ctx.stroke();
    }

    // ---- Logos ----
    const nearSet = state.nearSet;
    const special = i => i === focus || i === hover || i === preview || nearSet.has(i);
    const plates = new Map(); // dot → radius: names sit beside the plate, not on it
    const wanted = [];
    if (z >= LOGOS_FROM) {
      for (let i = 0; i < world.n; i++) if (onScreen(i) && !special(i)) wanted.push(i);
      // The bigger dots and the ones nearest the middle of the view get a logo first.
      const cx = w / 2;
      const cy = h / 2;
      wanted.sort((a, b) => world.size[b] - world.size[a] || (sx[a] - cx) ** 2 + (sy[a] - cy) ** 2 - ((sx[b] - cx) ** 2 + (sy[b] - cy) ** 2));
      wanted.length = Math.min(wanted.length, MOST_LOGOS);
    }
    const first = [focus, ...near.map(item => item.index), hover, preview].filter((i, at, all) => i >= 0 && all.indexOf(i) === at && onScreen(i));
    const growth = ramp(LOGOS_FROM, LOGOS_FROM + 1.6, z);
    const plateFor = i => {
      if (i === focus) return 15;
      if (i === hover || i === preview) return 13;
      if (nearSet.has(i)) return 11.5;
      return 8.5 + growth * 4 + world.size[i] * 1.5;
    };
    for (const i of [...wanted.reverse(), ...first]) {
      const address = world.icons[i];
      const isGithub = world.github[i];
      if (!isGithub && !address) continue;
      const entry = isGithub ? null : this.logo(address);
      if (!isGithub && !entry) continue;
      const radius = plateFor(i);
      plates.set(i, radius);
      const standsOut = special(i) || lit?.has(i) || (picked && world.category[i] === picked);
      const strength = standsOut ? 1 : 1 - state.dim * 0.7;
      if (this.plate(sx[i], sy[i], radius, colors.hue.get(world.category[i]) ?? colors.muted, address, entry, isGithub, now, colors, strength)) busy = true;
    }
    this.loadWaiting();

    // ---- The ring that ripples out from the picked dot ----
    if (focus >= 0 && onScreen(focus) && !calm()) {
      const ripple = (now - state.focusSince) / 1000;
      if (ripple < 2) {
        const phase = ripple % 1;
        const base = plates.get(focus) ?? dotRadius(focus);
        ctx.beginPath();
        ctx.arc(sx[focus], sy[focus], base + 3 + phase * 24, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(colors.hue.get(world.category[focus]) ?? colors.accent, 0.5 * (1 - phase));
        ctx.lineWidth = 2;
        ctx.stroke();
        busy = true;
      }
    }

    // ---- Names ----
    if (this.drawNames(state, plates, onScreen, now)) busy = true;
    return busy;
  }

  drawNames(state, plates, onScreen, now) {
    const { ctx, w, h } = this;
    const { world, colors, view, focus, near, lit, preview, covered, dotRadius, sx, sy, picked, dim } = state;
    const z = view.k / WHOLE_MAP;
    const body = colors.fontBody;
    const display = colors.fontDisplay;
    const small = w < 500;
    const busyFocus = focus >= 0 || Boolean(lit);
    const wanted = [];
    const seen = new Set(); // a dot can be asked for twice (a closest link that you also point at): the first one counts
    const add = label => {
      if (label.alpha <= 0.02 || seen.has(label.key)) return;
      seen.add(label.key);
      wanted.push(label);
    };
    const room = i => (plates.get(i) ?? dotRadius(i)) + 5;

    if (focus >= 0) add({ key: `d${focus}`, text: shorten(world.titles[focus]), x: sx[focus], y: sy[focus], dot: room(focus), font: `700 14px ${body}`, fill: colors.text, rank: 1000, alpha: 1 });
    if (preview >= 0 && preview !== focus && onScreen(preview, 0)) {
      add({ key: `d${preview}`, text: shorten(world.titles[preview]), x: sx[preview], y: sy[preview], dot: room(preview), font: `700 13px ${body}`, fill: colors.text, rank: 950, alpha: 1 });
    }
    near.forEach(({ index }, place) => {
      if (onScreen(index, 0)) add({ key: `d${index}`, text: shorten(world.titles[index]), x: sx[index], y: sy[index], dot: room(index), font: `600 12.5px ${body}`, fill: colors.text, rank: 900 - place, alpha: 1 });
    });
    if (lit) {
      for (const i of lit) {
        if (i !== focus && onScreen(i, 0)) add({ key: `d${i}`, text: shorten(world.titles[i]), x: sx[i], y: sy[i], dot: room(i), font: `600 12.5px ${body}`, fill: colors.text, rank: 800, alpha: 1 });
      }
    }

    // Island names step back while a link or search results are picked. Up close they give way to topics and link names.
    const faded = busyFocus ? 0.55 : 1;
    const islandAlpha = 1 - ramp(3.4, 4.6, z);
    const grow = clamp(z ** 0.2, 1, 1.3);
    for (const island of world.islands) {
      // In half-pixel steps: a new size means measuring the name and drawing its picture again, and a zoom shouldn't do
      // that on every frame.
      const base = Math.round(clamp(10.2 + Math.log2(Math.max(island.count, 1)) * 1.42, 12, 21) * (small ? 0.76 : 1) * grow * 2) / 2;
      const font = `700 ${base}px ${display}`;
      const width = this.textWidth(font, island.text);
      // A small island shows its name once the name is not much wider than the land it names. A category with no land
      // of its own (its few dots stand in other countries) waits until you are closer.
      const landWidth = island.box ? (island.box[2] - island.box[0]) * view.k : z >= 2.2 ? width : 0;
      const fits = landWidth >= width * 0.62 || island.category === picked;
      const alpha = (island.category === picked ? 1 : islandAlpha * faded) * (fits ? 1 : 0);
      add({
        key: island.key,
        text: island.text,
        x: view.ox + island.x * view.k,
        y: view.oy + island.y * view.k,
        center: true,
        font,
        fill: colors.ink.get(island.category) ?? colors.text2,
        haloWidth: 5,
        rank: (island.category === picked ? 950 : 600) + island.count / 1e4,
        alpha,
        island: island.category,
      });
    }
    for (const topic of world.topics) {
      const alpha = topic.level === 1 ? ramp(1.9, 2.5, z) * (1 - ramp(6.5, 8.5, z)) : ramp(3.6, 4.6, z) * (1 - ramp(11, 14, z));
      if (alpha < 0.02) continue;
      add({
        key: topic.key,
        text: topic.text.toUpperCase(),
        x: view.ox + topic.x * view.k,
        y: view.oy + topic.y * view.k,
        center: true,
        spaced: true,
        font: `650 ${topic.level === 1 ? 11.5 : 10.5}px ${display}`,
        fill: colors.text2,
        rank: (topic.level === 1 ? 500 : 400) + topic.count / 1e4,
        alpha: alpha * (busyFocus ? 0.5 : 0.85),
      });
    }
    const nameAlpha = ramp(LINK_NAMES_FROM, LINK_NAMES_FROM + 0.5, z);
    const ownAlpha = ramp(1.5, 2.1, z); // a picked island shows the names of its own links sooner
    if (nameAlpha > 0.02 || picked) {
      for (let i = 0; i < world.n; i++) {
        if (!onScreen(i, 0)) continue;
        // While something is picked, the other names recede; the picked island's own names stay clear.
        const own = picked && world.category[i] === picked;
        const receding = !own && dim > 0.3;
        add({
          key: `d${i}`,
          text: shorten(world.titles[i]),
          x: sx[i],
          y: sy[i],
          dot: room(i),
          font: `${world.size[i] || own ? 600 : 500} ${world.size[i] === 2 ? 12.5 : 12}px ${body}`,
          fill: own ? colors.text : receding ? colors.muted : colors.text2,
          rank: 300 + (own ? 50 : 0) + world.size[i] * 10,
          alpha: own ? ownAlpha : nameAlpha * (receding ? 0.62 : 1),
        });
      }
    }

    // A name that is already showing goes before an equal new one, so names don't swap places while you move.
    const before = this.shown;
    const stay = label => ((before.get(label.key)?.alpha ?? 0) > 0.4 ? 40 : 0);
    wanted.sort((a, b) => b.rank + stay(b) - (a.rank + stay(a)));
    const taken = new TakenSpots();
    // No names under the bars and panels: they'd be half hidden there.
    for (const box of covered) taken.take(box);
    // Close up, no name covers another link's dot or logo. (The names that matter most are placed before this.)
    const keepDotsClear = () => {
      if (z < LINK_NAMES_FROM && !picked) return;
      for (let i = 0; i < world.n; i++) {
        if (!onScreen(i, 0)) continue;
        const size = room(i) - 4;
        taken.take({ l: sx[i] - size, r: sx[i] + size, t: sy[i] - size, b: sy[i] + size });
      }
    };
    let dotsClear = false;
    // The picked dot, its closest dots and the search results are kept clear of names. (A name beside its own dot still
    // fits: it starts a little further out than this.)
    const keepClear = index => {
      const size = room(index) - 3;
      taken.take({ l: sx[index] - size, r: sx[index] + size, t: sy[index] - size, b: sy[index] + size });
    };
    if (focus >= 0) {
      keepClear(focus);
      for (const { index } of near) keepClear(index);
    }
    if (lit) for (const i of lit) if (onScreen(i, 0)) keepClear(i);
    const placedNow = new Set();
    const boxes = [];
    let placed = 0;
    for (const label of wanted) {
      if (placed > 200) break; // more than this is unreadable anyway, and keeps each frame quick
      if (!dotsClear && label.rank < 800) {
        dotsClear = true;
        keepDotsClear();
      }
      const width = this.textWidth(label.font, label.text, label.spaced);
      const height = Number.parseFloat(label.font.split(' ')[1]) * 1.25;
      // Link names sit to the right of their dot, or else to the left, above or below it; group names on their spot.
      const spots = label.center
        ? [[label.x - width / 2, label.y]]
        : [
            [label.x + label.dot, label.y],
            [label.x - label.dot - width, label.y],
            [label.x - width / 2, label.y - label.dot - height / 2 + 2],
            [label.x - width / 2, label.y + label.dot + height / 2 - 2],
          ];
      let box = null;
      let y = label.y;
      for (const [left, middle] of spots) {
        const candidate = { l: left - 4, r: left + width + 4, t: middle - height / 2 - 1, b: middle + height / 2 + 1 };
        // A name is either wholly on the screen or not there at all: half a name helps nobody.
        if (candidate.l < 2 || candidate.r > w - 2 || candidate.t < 2 || candidate.b > h - 2) continue;
        if (taken.free(candidate)) {
          box = candidate;
          y = middle;
          break;
        }
      }
      if (!box) continue;
      taken.take(box);
      placed++;
      placedNow.add(label.key);
      label.left = box.l + 4;
      label.top = y;
      label.mapX = (label.x - view.ox) / view.k;
      label.mapY = (label.y - view.oy) / view.k;
      if (label.island) boxes.push({ l: box.l, r: box.r, t: box.t, b: box.b, category: label.island });
      const known = before.get(label.key);
      if (known) {
        known.label = label;
      } else {
        before.set(label.key, { label, alpha: 0 });
      }
    }
    this.nameBoxes = boxes;

    // Every name fades in or out, toward where it should be.
    const elapsed = this.lastTime ? now - this.lastTime : 16;
    this.lastTime = now;
    const step = calm() ? 1 : Math.min(elapsed, 50) / FADE_MS;
    let busy = false;
    const { dpr } = this;
    const onPixels = value => Math.round(value * dpr) / dpr; // text is sharpest on whole pixels
    for (const [key, item] of before) {
      const goal = placedNow.has(key) ? 1 : 0;
      item.alpha = goal > item.alpha ? Math.min(goal, item.alpha + step) : Math.max(goal, item.alpha - step);
      if (item.alpha <= 0.001) {
        before.delete(key);
        continue;
      }
      if (item.alpha !== goal) busy = true;
      const { label } = item;
      // A name that lost its place fades out, moving along with the map.
      if (!goal) {
        const x = view.ox + label.mapX * view.k;
        const y = view.oy + label.mapY * view.k;
        label.left += x - label.x;
        label.top += y - label.y;
        label.x = x;
        label.y = y;
      }
      const found = this.namePicture(label, colors);
      if (!found) {
        busy = true;
        continue;
      }
      ctx.globalAlpha = item.alpha * label.alpha;
      ctx.drawImage(found.canvas, onPixels(label.left - found.pad), onPixels(label.top - found.height / 2), found.width, found.height);
    }
    ctx.globalAlpha = 1;
    return busy;
  }
}
