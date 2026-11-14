// The land of the Explore map, painted on a plain 2D canvas that lies under Sigma's dots and lines.
//
// The server sends the shapes as short paths (see server/land.js). Here they become Path2D objects once; after that only
// the camera changes (setTransform). Nothing is worked out again while you move.
//
// The layers, from the bottom up: a faint grid on the sea, a soft glow in the water around the coast (one picture made
// ahead of time, because blurring is slow), the land, each country in its category's tint, height lines, borders, and
// the coast (see land-paint.js).
//
// Painting all those shapes takes the browser much longer than the 16 milliseconds a smooth frame may take. So while you
// move, each frame only slides and stretches a picture that was painted before (one picture: very quick):
// - far out, a big picture of the whole map;
// - closer in, a "sheet" a little bigger than the screen, painted again when you have moved too far for it.
// When the map comes to rest, the sheet is painted at the exact zoom, so everything is sharp.
// Those pictures are painted in the background (land-worker.js), so the map never freezes: until a new one arrives, it
// shows the sharpest one it has. Only a browser without that painter paints them right here.
import { mix, rgba } from './colors.js';
import { makeGlow, newCanvas, paintLand, readLand } from './land-paint.js';

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const SHEET_SIZE = 1.5; // the sheet is this much wider and taller than the screen
const MOST_STRETCH = 1.4; // how far a picture may be stretched while you zoom in, before it looks too soft
const WHOLE_MAP_MOST = 3200; // the big picture of the whole map is at most this many pixels wide
const SHARPEST = 1.5; // the land is painted at most this sharp on a high-resolution screen: four times the pixels add little to soft shapes, and they cost a lot

// Runs something when the browser has a quiet moment. (Safari doesn't have requestIdleCallback.)
const whenIdle = work => (window.requestIdleCallback ? window.requestIdleCallback(work, { timeout: 1500 }) : window.setTimeout(work, 300));
const cancelIdle = id => {
  if (!id) return;
  if (window.cancelIdleCallback) window.cancelIdleCallback(id);
  else window.clearTimeout(id);
};

// The painter in the background, if this browser can run one.
function startPainter(onPicture, onFailed) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  try {
    const worker = new Worker(new URL('./land-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => onPicture(data);
    worker.onerror = onFailed;
    return worker;
  } catch {
    return null;
  }
}

export class LandLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.picture = null; // the sheet: a finished picture
    this.base = null; // the view it was painted for
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.scale = 1;
    this.shapes = null;
    this.coast = null;
    this.countries = [];
    this.byCategory = new Map();
    this.colors = null;
    this.glow = null;
    this.aspect = 0.6;
    this.lastView = null;
    this.lastLook = null;
    this.whole = null; // the big picture of the whole map
    this.wholeAsked = false;
    this.wholeTimer = 0;
    this.jobs = new Map(); // the pictures the painter is working on: what to do with each
    this.nextId = 0;
    this.sheetBusy = false;
    this.nextSheet = null; // the view to paint next, when the painter is free
    this.painter = startPainter(
      answer => this.pictureReady(answer),
      () => this.painterFailed(),
    );
  }

  setLand(land, aspect) {
    this.aspect = aspect;
    this.forgetPictures();
    this.glow = null; // made again when it's next needed
    this.painter?.postMessage({ type: 'land', land, aspect });
    if (!land) {
      this.shapes = null;
      this.coast = null;
      this.countries = [];
      this.byCategory = new Map();
      return;
    }
    this.shapes = readLand(land);
    this.scale = land.scale;
    this.coast = this.shapes.coast.path;
    this.countries = this.shapes.countries;
    this.byCategory = new Map(this.countries.map(country => [country.category, country]));
  }

  setColors(colors) {
    this.colors = colors;
    this.glow = null;
    this.forgetPictures();
    this.painter?.postMessage({ type: 'colors', colors });
  }

  resize(width, height, dpr) {
    this.w = width;
    this.h = height;
    this.dpr = Math.min(dpr, SHARPEST);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.forgetPictures();
  }

  // The pictures no longer match (new colors, size or land). What the painter is still working on is thrown away too.
  forgetPictures() {
    this.jobs.clear();
    this.sheetBusy = false;
    this.nextSheet = null;
    this.usePicture(null, null);
    this.whole?.canvas.close?.();
    this.whole = null;
    this.wholeAsked = false;
    cancelIdle(this.wholeTimer);
    this.wholeTimer = 0;
  }

  usePicture(picture, base) {
    if (this.picture !== picture) this.picture?.close?.();
    this.picture = picture;
    this.base = base;
  }

  // Which category's land is at this spot on screen, or null for the sea.
  hit(view, x, y) {
    if (!this.coast) return null;
    const { ctx, dpr } = this;
    const unit = view.k / this.scale;
    ctx.save();
    ctx.setTransform(unit * dpr, 0, 0, unit * dpr, view.ox * dpr, view.oy * dpr);
    const px = x * dpr;
    const py = y * dpr;
    let found = null;
    // Painted biggest first, so the last one that contains the spot is the one you see there.
    for (let i = this.countries.length - 1; i >= 0 && !found; i--) {
      const { category, path } = this.countries[i];
      if (ctx.isPointInPath(path, px, py, 'evenodd')) found = category;
    }
    ctx.restore();
    return found;
  }

  // A faint grid of lines on the sea. As you zoom, the lines double up, so they stay about the same distance apart.
  drawGrid(view) {
    const { ctx, w, h, colors } = this;
    const level = Math.floor(Math.log2(view.k / 90));
    const step = 1 / 2 ** level; // map units between lines
    const gap = step * view.k;
    const fine = clamp((gap - 90) / 90, 0, 1); // the in-between lines fade in as they get room
    const lines = (every, alpha) => {
      ctx.strokeStyle = rgba(colors.grid, colors.grid[3] * alpha);
      ctx.lineWidth = 1;
      ctx.beginPath();
      const spacing = every * view.k;
      const firstX = Math.ceil(-view.ox / spacing);
      for (let i = 0; i <= w / spacing; i++) {
        const x = Math.round(view.ox + (firstX + i) * spacing) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      const firstY = Math.ceil(-view.oy / spacing);
      for (let i = 0; i <= h / spacing; i++) {
        const y = Math.round(view.oy + (firstY + i) * spacing) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();
    };
    lines(step, 1);
    if (fine > 0.02) lines(step / 2, fine * 0.6);
  }

  // The big picture of the whole map, for moving around far out without painting anything.
  paintWholeMap() {
    this.wholeTimer = 0;
    if (!this.shapes || !this.colors || !this.w) return;
    const width = Math.min(WHOLE_MAP_MOST, Math.ceil(Math.max(this.w, 700) * this.dpr * 1.6));
    const pad = Math.round(width * 0.09); // room for the glow around the coast
    // (Lines a little thicker than on the sheet: this picture is mostly shown smaller than it's painted.)
    const job = { width: width + pad * 2, height: Math.ceil(width * this.aspect) + pad * 2, unit: width / this.scale, x: pad, y: pad, line: this.dpr * 1.3, full: true };
    this.paint(job, picture => {
      this.whole = { canvas: picture, k: width, pad };
      if (this.lastView) this.draw(this.lastView, this.lastLook);
    });
  }

  // Paints a picture: in the background if it can, or else right here.
  paint(job, done) {
    if (this.painter) {
      const id = ++this.nextId;
      this.jobs.set(id, done);
      this.painter.postMessage({ type: 'paint', id, ...job });
      return;
    }
    done(this.paintHere(job));
  }

  paintHere(job) {
    this.glow ??= makeGlow(this.shapes, this.colors, this.aspect);
    const canvas = newCanvas(job.width, job.height);
    paintLand(canvas.getContext('2d'), this.shapes, this.colors, this.glow, job);
    return canvas;
  }

  pictureReady({ id, picture }) {
    const done = this.jobs.get(id);
    this.jobs.delete(id);
    if (!done) picture?.close(); // it's for pictures that were forgotten in the meantime
    else if (picture) done(picture);
    else this.sheetBusy = false;
  }

  // The painter couldn't start (or a browser can't paint in the background after all): from now on, it's painted here.
  painterFailed() {
    this.painter?.terminate();
    this.painter = null;
    this.forgetPictures();
    if (this.lastView) this.draw(this.lastView, this.lastLook);
  }

  // What a sheet for this view looks like: the screen lies in its middle.
  sheetJob(view, full) {
    const { w, h, dpr, scale } = this;
    const width = Math.ceil(w * SHEET_SIZE * dpr);
    const height = Math.ceil(h * SHEET_SIZE * dpr);
    const marginX = (width / dpr - w) / 2;
    const marginY = (height / dpr - h) / 2;
    return {
      job: { width, height, unit: (view.k / scale) * dpr, x: (view.ox + marginX) * dpr, y: (view.oy + marginY) * dpr, line: dpr, full },
      base: { k: view.k, ox: view.ox, oy: view.oy, marginX, marginY, width: width / dpr, height: height / dpr, complete: full },
    };
  }

  // Asks for a new sheet. The painter does one at a time, and the next one is for wherever you are by then.
  askSheet(view, full) {
    if (!this.shapes) return;
    if (this.sheetBusy) {
      this.nextSheet = { view, full };
      return;
    }
    const { job, base } = this.sheetJob(view, full);
    this.sheetBusy = true;
    this.paint(job, picture => {
      this.sheetBusy = false;
      this.usePicture(picture, base);
      const next = this.nextSheet;
      this.nextSheet = null;
      if (next) this.askSheet(next.view, next.full);
      if (this.lastView) this.draw(this.lastView, this.lastLook);
    });
  }

  // Can the sheet reach all the edges of the screen, however much it's stretched?
  sheetCovers(view) {
    const { base, w, h } = this;
    if (!base) return false;
    const stretch = view.k / base.k;
    const left = view.ox - (base.ox + base.marginX) * stretch;
    const top = view.oy - (base.oy + base.marginY) * stretch;
    return left <= 0 && top <= 0 && left + base.width * stretch >= w && top + base.height * stretch >= h;
  }

  // view: { k: pixels per map unit, ox, oy: where the map's top-left corner is on screen }.
  // look: { dim: 0…1 how much everything recedes, picked: the category to keep bright, glow: its share of brightness }.
  // gliding: the camera is flying somewhere by itself: for that second, a softer picture is fine, and nothing is repainted.
  draw(view, look, gliding = false) {
    const { ctx, w, dpr, colors, canvas } = this;
    if (!colors || !w) return;
    this.lastView = view;
    this.lastLook = look;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawGrid(view);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // The very first picture is painted right away, so the land is there from the start. (Without its fine details.)
    if (!this.base && !this.whole && this.shapes) {
      const { job, base } = this.sheetJob(view, false);
      this.usePicture(this.paintHere(job), base);
    }

    const { base, whole, picture } = this;
    const covers = this.sheetCovers(view);
    const stretch = base ? view.k / base.k : 0;
    if (covers && stretch === 1) {
      // The sharp sheet at its own zoom. On whole pixels, which keeps it sharp.
      ctx.drawImage(picture, Math.round((view.ox - base.ox - base.marginX) * dpr), Math.round((view.oy - base.oy - base.marginY) * dpr));
    } else {
      const wholeWillDo = whole && view.k * dpr <= whole.k * MOST_STRETCH;
      const sheetIsSharper = covers && base.k * dpr > (whole?.k ?? 0);
      if (whole && !sheetIsSharper && (wholeWillDo || !covers)) {
        const by = (view.k * dpr) / whole.k;
        ctx.drawImage(whole.canvas, view.ox * dpr - whole.pad * by, view.oy * dpr - whole.pad * by, whole.canvas.width * by, whole.canvas.height * by);
      } else if (base) {
        const left = (view.ox - (base.ox + base.marginX) * stretch) * dpr;
        const top = (view.oy - (base.oy + base.marginY) * stretch) * dpr;
        ctx.drawImage(picture, left, top, base.width * stretch * dpr, base.height * stretch * dpr);
      }
      // Too soft by now, or it doesn't reach the edges: a new one is on its way. (Not during a glide, which is over in
      // a second: then the sharp picture comes at the end.)
      const needsNew = !covers || stretch > MOST_STRETCH || stretch < 1 / SHEET_SIZE;
      if (!gliding && !wholeWillDo && needsNew) this.askSheet(view, false);
    }

    if (look.dim > 0.005) {
      // Everything recedes a little, by laying a thin sheet of sea color over it.
      ctx.fillStyle = rgba(colors.sea, look.dim * 0.5);
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // The category you point at or picked stands out: its full color back, and a clear outline.
    const picked = look.picked && this.byCategory.get(look.picked);
    if (picked && look.glow > 0.005) {
      const unit = view.k / this.scale;
      const hue = colors.hue.get(look.picked) ?? colors.muted;
      ctx.setTransform(unit * dpr, 0, 0, unit * dpr, view.ox * dpr, view.oy * dpr);
      ctx.lineJoin = 'round';
      ctx.globalAlpha = look.glow;
      ctx.fillStyle = rgba(mix(hue, colors.land, colors.dark ? 0.42 : 0.38));
      ctx.fill(picked.path, 'evenodd');
      ctx.strokeStyle = rgba(hue, 0.95);
      ctx.lineWidth = 1.6 / unit;
      ctx.stroke(picked.path);
      ctx.globalAlpha = 1;
    }
  }

  // The map has come to rest: the sheet is painted at the exact zoom, with everything on it, so all is sharp.
  sharpen() {
    const { base, lastView } = this;
    if (!lastView) return;
    if (!base || base.k !== lastView.k || !base.complete || !this.sheetCovers(lastView)) this.askSheet(lastView, true);
    if (this.whole || this.wholeAsked || !this.shapes) return;
    // The picture of the whole map, when it can't get in the way of opening the page or changing the theme.
    this.wholeAsked = true;
    if (this.painter) this.paintWholeMap();
    else this.wholeTimer = whenIdle(() => this.paintWholeMap());
  }

  kill() {
    cancelIdle(this.wholeTimer);
    this.painter?.terminate();
    this.painter = null;
    this.jobs.clear();
    this.usePicture(null, null);
  }
}
