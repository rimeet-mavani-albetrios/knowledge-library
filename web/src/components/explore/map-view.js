// The Explore map's engine. Three layers lie on top of each other, all following one camera:
//   1. a 2D canvas with the land (land-layer.js),
//   2. Sigma, which draws the dots and lines with WebGL, moves the camera (drag, pinch) and finds what's under the mouse,
//   3. a 2D canvas with the names and logos (overlay.js).
//
// It lives outside React on purpose. Moving the map changes the picture 60 times a second; doing that through React
// would work out the whole page again each time. So React tells the engine what to show (setFocus, setLit…) and the
// engine tells React what was clicked or pointed at. Between those, it draws on its own.
//
// All three layers are painted together, right after Sigma has drawn a frame, so land, dots and names never slip apart.
//
// A camera here is { x, y, k }: the map spot in the middle of what you can see (not hidden by the bars and the card), and
// screen pixels per map unit. Sigma counts differently (see toSigma), so that's translated in one place only.
import Graph from 'graphology';
import Sigma from 'sigma';
import { layerFill, layerGradient, pathCurved, sdfCircle } from 'sigma/rendering';
import { LandLayer } from './land-layer.js';
import { Overlay } from './overlay.js';
import { mix, rgba } from './colors.js';

const MIN_ZOOM = 0.7; // × the zoom that shows the whole map
const MAX_ZOOM = 18;
const MOST_PIXELS = 12000; // however small the screen, you can zoom in until the map is this many pixels across
const DOT_SIZES = [3.9, 4.9, 6.3]; // how big dots are drawn when you see the whole map: village, town, city
const HOVER_REACH = 10; // a mouse this close to a dot (in pixels) counts as being on it
const TAP_REACH = 24; // on a touch screen, a tap this close to a dot counts as a tap on it
const DOUBLE_CLICK = 250; // two clicks within this many milliseconds are a double click

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const calm = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A glide from one view to another that rises a little when the two are far apart, like a plane that climbs,
// flies over and lands, so you see where you are going (van Wijk and Nuij's "smooth and efficient zooming", the
// same curve d3 uses). A view is [x, y, how wide the view is in map units].
function glide([x0, y0, w0], [x1, y1, w1]) {
  const rho = Math.SQRT2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) {
    const s = Math.log(w1 / w0) / rho;
    return { length: Math.abs(s), at: t => [x0 + t * dx, y0 + t * dy, w0 * Math.exp(rho * t * s)] };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho ** 4 * d2) / (2 * w0 * rho ** 2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho ** 4 * d2) / (2 * w1 * rho ** 2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const s = (r1 - r0) / rho;
  return {
    length: Math.abs(s),
    at: t => {
      const u = (w0 / (rho ** 2 * d1)) * (Math.cosh(r0) * Math.tanh(rho * t * s + r0) - Math.sinh(r0));
      return [x0 + u * dx, y0 + u * dy, (w0 * Math.cosh(r0)) / Math.cosh(rho * t * s + r0)];
    },
  };
}

// The thin ring around every dot (like a city on a printed map), or the bigger ring around a picked one. Sigma mixes this
// over the dot's own color; `sdf` is the distance to the dot's edge, negative inside.
const RING_LAYER = {
  name: 'ring',
  uniforms: [],
  attributes: [
    { name: 'ringColor', size: 4, type: 5121 /* a byte per color part */, normalized: true, source: 'ringColor' },
    { name: 'ringWidth', size: 1, type: 5126 /* a decimal number */, source: 'ringWidth' },
  ],
  glsl: `
vec4 layer_ring(vec4 v_ringColor, float v_ringWidth) {
  float inner = -v_ringWidth * context.pixelToUV;
  float amount = smoothstep(inner - context.aaWidth * 0.5, inner + context.aaWidth * 0.5, context.sdf);
  return vec4(v_ringColor.rgb, v_ringColor.a * amount);
}
`,
};

// While something is picked, every other dot recedes: it fades toward the color of the land. Dots that stay bright have
// `keep` 1. The amount is one number the graphics card reads each frame (u_recede), so a fade costs nothing per dot.
const recedeLayer = (amount, color) => ({
  name: 'recede',
  uniforms: [amount, color],
  attributes: [{ name: 'keep', size: 1, type: 5126 /* a decimal number */, source: 'keep' }],
  glsl: `
vec4 layer_recede(float v_keep, float u_recede, vec3 u_recedeColor) {
  return vec4(u_recedeColor, u_recede * (1.0 - v_keep));
}
`,
});

export class MapView {
  // box: the element Sigma fills. on: { pick(index), pickIsland(category), clear(), hover(index, x, y), moved() }
  constructor(box, on) {
    this.box = box;
    this.on = on;
    this.world = null;
    this.colors = null;
    this.focus = -1;
    this.focusSince = 0;
    this.near = [];
    this.nearSet = new Set();
    this.lit = null;
    this.hover = -1;
    this.preview = -1; // a dot pointed at from outside the map: a row in the side card
    this.pointed = ''; // the category pointed at in the Topics panel
    this.island = ''; // the picked island's category
    this.dim = 0;
    this.dimGoal = 0;
    this.glow = 0;
    this.glowGoal = 0;
    this.glowCategory = '';
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.covered = []; // parts of the screen covered by panels, where no names should go
    this.home = 600;
    this.K = 1; // Sigma's pixels per unit at its own zoom 1
    this.motion = null; // a glide in progress
    this.wheel = null; // a smooth zoom from the mouse wheel
    this.raf = 0;
    this.landKey = '';
    this.sx = new Float32Array(0);
    this.sy = new Float32Array(0);
    this.w = box.clientWidth;
    this.h = box.clientHeight;
    this.miniCanvas = null;
    this.miniPicture = null;
    this.landClick = 0;
    this.dotScale = 1;

    this.recedeAmount = { name: 'u_recede', type: 'float', value: 0 };
    this.recedeColor = { name: 'u_recedeColor', type: 'vec3', value: [0.5, 0.5, 0.5] };

    this.graph = new Graph({ type: 'undirected', multi: false, allowSelfLoops: false });
    // Throws when the browser has no WebGL 2. Explore.jsx catches that and shows a friendly message.
    this.sigma = new Sigma(this.graph, box, {
      primitives: {
        // From the bottom up: the ordinary dots, the lines of a picked dot, then the dots that are picked or lit.
        depthLayers: ['nodes', 'edges', 'topNodes'],
        nodes: {
          shapes: [sdfCircle()],
          layers: [layerFill(), RING_LAYER, recedeLayer(this.recedeAmount, this.recedeColor)],
          variables: {
            ringColor: { type: 'color', default: '#ffffff' },
            ringWidth: { type: 'number', default: 1 },
            keep: { type: 'number', default: 0 },
          },
        },
        edges: {
          paths: [pathCurved({ segments: 28 })],
          // A line takes the color of the dot it leaves and blends into the color of the dot it reaches.
          layers: [layerGradient({ stops: [{ node: 'source' }, { node: 'target' }] })],
        },
      },
      styles: {
        nodes: {
          x: { attribute: 'x' },
          y: { attribute: 'y' },
          size: { attribute: 'size' },
          color: { attribute: 'color' },
          depth: 'nodes',
          visibility: 'visible',
          labelVisibility: 'hidden',
          backdropVisibility: 'hidden',
        },
        edges: {
          size: { attribute: 'size' },
          color: '#888888', // (not seen: lines take their colors from the dots they join)
          opacity: { attribute: 'opacity', defaultValue: 1 },
          curvature: { attribute: 'curvature', defaultValue: 0.16 },
          depth: 'edges',
          path: 'curved',
          visibility: 'visible',
        },
        stage: { cursor: { whenState: 'isPanning', then: 'grabbing', else: 'grab' } },
      },
      nodeReducer: (key, data, attrs) => this.dotLook(attrs.i, data),
      settings: {
        renderLabels: false, // names are drawn in overlay.js
        renderEdgeLabels: false,
        itemSizesReference: 'screen',
        // Dots grow gently as you zoom in, so they are easy to hit up close.
        zoomToSizeRatioFunction: ratio => (ratio / this.homeRatio()) ** 0.34,
        stagePadding: 0,
        enableCameraRotation: false,
        enableCameraMouseRotation: false,
        minEdgeThickness: 0.5,
        allowInvalidContainer: true,
        inertiaDuration: 320,
        inertiaRatio: 3.2,
        doubleClickTimeout: DOUBLE_CLICK,
        doubleClickZoomingDuration: 320,
        doubleClickZoomingRatio: 2.2,
      },
    });
    this.camera = this.sigma.getCamera();

    this.landCanvas = this.sigma.createCanvas('atlas-land', { beforeLayer: 'stage' });
    this.overCanvas = this.sigma.createCanvas('atlas-names', { afterLayer: 'stage' });
    this.overCanvas.style.pointerEvents = 'none';
    this.land = new LandLayer(this.landCanvas);
    this.overlay = new Overlay(this.overCanvas, () => this.sigma.scheduleRender());
    this.sizeLayers();

    this.listen();
  }

  // ---------- What to show (called by React) ----------

  // A fresh map (a link was added while you look) keeps your place on the map.
  setWorld(world) {
    const again = Boolean(this.world);
    const before = again ? this.cameraNow() : null;
    this.world = world;
    this.focus = -1;
    this.near = [];
    this.nearSet = new Set();
    this.hover = -1;
    this.sx = new Float32Array(world.n);
    this.sy = new Float32Array(world.n);
    this.land.setLand(world.land, world.aspect);
    this.overlay.shown.clear();
    this.miniPicture = null;

    const { graph, sigma } = this;
    graph.clear();
    for (let i = 0; i < world.n; i++) graph.addNode(world.ids[i], { x: world.x[i], y: -world.y[i], size: DOT_SIZES[world.size[i]], color: '#888', i });
    // The whole map's frame, whatever the dots do: 1 wide and `aspect` tall (y is negative because Sigma's y goes up).
    sigma.setCustomBBox({ x: [0, 1], y: [-world.aspect, 0] });
    sigma.refresh({ schedule: false });
    this.measure();
    this.setBoundaries();
    this.jumpTo(before ?? this.fitCamera(null));
    this.paintSoon();
  }

  setColors(colors) {
    this.colors = colors;
    this.land.setColors(colors);
    this.overlay.clearMeasures();
    this.landKey = '';
    this.miniPicture = null;
    this.recedeColor.value = mix(colors.land, colors.sea, 0.6).map(value => value / 255);
    if (this.world) this.refreshDots();
  }

  setFocus(index) {
    if (index === this.focus) return;
    const before = [this.focus, ...this.near.map(item => item.index)];
    this.focus = index;
    this.focusSince = performance.now();
    this.near = index >= 0 ? this.world.near[index] : [];
    this.nearSet = new Set(this.near.map(item => item.index));
    this.drawLines();
    this.updateGoals();
    this.restyle([...before, index, ...this.nearSet, ...this.standOutDots()]);
  }

  setLit(lit) {
    const before = this.lit ?? [];
    this.lit = lit?.size ? lit : null;
    this.updateGoals();
    this.restyle([...before, ...(this.lit ?? []), ...this.standOutDots()]);
  }

  // The category pointed at in the Topics panel.
  setPointed(category) {
    if (category === this.pointed) return;
    const before = this.standOutDots();
    this.pointed = category;
    this.updateGoals();
    this.restyle([...before, ...this.standOutDots()]);
  }

  // The picked island.
  setIsland(category) {
    if (category === this.island) return;
    const before = this.standOutDots();
    this.island = category;
    this.updateGoals();
    this.restyle([...before, ...this.standOutDots()]);
  }

  // The dots of the island that stands out now.
  standOutDots() {
    const category = this.pointed || this.island;
    return this.world?.categories.find(item => item.name === category)?.dots ?? [];
  }

  // A row in the side card points at this dot.
  setPreview(index) {
    if (index === this.preview) return;
    const before = this.preview;
    this.preview = index;
    this.restyle([before, index], { sameLayer: true });
  }

  // How much everything else recedes, and which island stands out, follows from what is picked.
  updateGoals() {
    const standOut = this.pointed || this.island;
    this.dimGoal = this.focus >= 0 || this.lit ? 1 : standOut ? 0.75 : 0;
    this.glowGoal = standOut && this.focus < 0 && !this.lit ? 1 : 0;
    if (standOut) this.glowCategory = standOut;
    this.kick();
  }

  // The bars and the card cover parts of the map: "the middle" and "fit" mean the middle of what's left.
  // The dots stay where they are on screen when this changes. (During a glide nothing needs doing: it's heading for
  // "the middle", wherever that is now.)
  setInsets(insets, covered = this.covered) {
    const next = { ...this.insets, ...insets };
    this.covered = covered;
    if (['top', 'right', 'bottom', 'left'].every(side => next[side] === this.insets[side])) {
      if (this.world) this.sigma.scheduleRender();
      return;
    }
    const steady = this.world && !this.motion;
    const before = steady ? this.cameraNow() : null;
    const centerBefore = this.center();
    this.insets = next;
    if (!this.world) return;
    this.measureHome();
    if (steady) {
      const centerAfter = this.center();
      before.x += (centerAfter.x - centerBefore.x) / before.k;
      before.y += (centerAfter.y - centerBefore.y) / before.k;
      this.jumpTo(before);
    }
    this.paintSoon();
  }

  // The small map in the corner. Its picture is made once; each frame only draws the rectangle of your view on it.
  setMiniMap(canvas) {
    this.miniCanvas = canvas;
    this.miniPicture = null;
    this.paintSoon();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.landClick);
    clearTimeout(this.sharpenTimer);
    this.overlay.onLogoReady = () => {}; // a logo that is still on its way finds nobody home
    this.land.kill();
    this.unlisten?.();
    this.sigma.kill();
  }

  // ---------- The camera ----------

  // Sigma's camera counts in its own units: the map's frame fits a box of 1 × 1, around (0.5, 0.5), with y going up, and
  // `ratio` gets smaller as you zoom in. These two turn that into { x, y, k } and back.
  measure() {
    const { sigma, world } = this;
    const { width, height } = sigma.getDimensions();
    this.w = width;
    this.h = height;
    this.R = world ? Math.max(1, world.aspect) : 1;
    const at = { x: 0.5, y: 0.5, angle: 0, ratio: 1 };
    const a = sigma.framedGraphToViewport({ x: 0, y: 0 }, { cameraState: at });
    const b = sigma.framedGraphToViewport({ x: 1, y: 0 }, { cameraState: at });
    this.K = b.x - a.x || 1;
    this.measureHome();
  }

  toSigma({ x, y, k }) {
    const { R, K, w, h } = this;
    const aspect = this.world?.aspect ?? 0.6;
    const c = this.center();
    const middleX = x + (w / 2 - c.x) / k;
    const middleY = y + (h / 2 - c.y) / k;
    return { x: 0.5 + (middleX - 0.5) / R, y: 0.5 + (aspect / 2 - middleY) / R, ratio: K / (k * R), angle: 0 };
  }

  fromSigma(state) {
    const { R, K, w, h } = this;
    const aspect = this.world?.aspect ?? 0.6;
    const k = K / (state.ratio * R);
    const c = this.center();
    const middleX = 0.5 + (state.x - 0.5) * R;
    const middleY = aspect / 2 - (state.y - 0.5) * R;
    return { x: middleX - (w / 2 - c.x) / k, y: middleY - (h / 2 - c.y) / k, k };
  }

  cameraNow() {
    return this.fromSigma(this.camera.getState());
  }

  jumpTo(target) {
    this.motion = null;
    this.wheel = null;
    this.camera.setState(this.toSigma({ ...target, k: this.limit(target.k) }));
  }

  center() {
    const { top, right, bottom, left } = this.insets;
    return { x: left + (this.w - left - right) / 2, y: top + (this.h - top - bottom) / 2 };
  }

  room() {
    const { top, right, bottom, left } = this.insets;
    return { w: Math.max(80, this.w - left - right), h: Math.max(80, this.h - top - bottom) };
  }

  // The zoom at which the whole map fits next to the panels, without the card (it comes and goes). Zoom levels are
  // measured against it, so a level means the same when the card opens.
  measureHome() {
    if (!this.world || !this.w) return;
    const width = Math.max(120, this.w - this.insets.left);
    const height = Math.max(120, this.h - this.insets.top);
    this.home = Math.min(width * 0.98, (height * 0.97) / this.world.aspect);
    // Dots keep their size on screen, so a small map (a phone) needs smaller dots, or they would hide the land.
    const scale = clamp((this.home / 1100) ** 0.62, 0.48, 1.15);
    if (scale !== this.dotScale) {
      this.dotScale = scale;
      if (this.colors) this.refreshDots();
    }
    const closest = this.K / (this.mostK() * this.R);
    const farthest = this.K / (this.home * MIN_ZOOM * this.R);
    if (closest !== this.sigma.getSetting('minCameraRatio') || farthest !== this.sigma.getSetting('maxCameraRatio')) {
      this.sigma.setSettings({ minCameraRatio: closest, maxCameraRatio: farthest });
    }
  }

  homeRatio() {
    return this.K / ((this.home || 1) * (this.R || 1));
  }

  mostK() {
    return Math.max(this.home * MAX_ZOOM, MOST_PIXELS);
  }

  // The map can't be dragged out of sight, but there is always room to bring any dot beside the card. (The same room
  // with or without a card: if it changed when a card closes, the map would jump.)
  setBoundaries() {
    if (!this.world) return;
    this.sigma.setSetting('cameraPanBoundaries', {
      tolerance: this.w < 700 ? 380 : 600,
      boundaries: { x: [0, 1], y: [-this.world.aspect, 0] },
    });
  }

  limit(k) {
    return clamp(k, this.home * MIN_ZOOM, this.mostK());
  }

  // A camera that shows these dots (all of them when null), with some room around them.
  fitCamera(indexes, { most = 12, least = MIN_ZOOM } = {}) {
    const { world } = this;
    if (!indexes) {
      const room = this.room();
      return { x: 0.5, y: world.aspect / 2, k: this.limit(Math.min(this.home, room.w * 0.98, (room.h * 0.97) / world.aspect)) };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const i of indexes) {
      minX = Math.min(minX, world.x[i]);
      maxX = Math.max(maxX, world.x[i]);
      minY = Math.min(minY, world.y[i]);
      maxY = Math.max(maxY, world.y[i]);
    }
    if (minX === Infinity) return { x: 0.5, y: world.aspect / 2, k: this.home };
    return this.fitBox([minX, minY, maxX, maxY], { most, least });
  }

  fitBox([minX, minY, maxX, maxY], { most = 12, least = MIN_ZOOM, room: share = 0.82 } = {}) {
    const room = this.room();
    const spanX = Math.max(maxX - minX, 0.02);
    const spanY = Math.max(maxY - minY, 0.02);
    const k = clamp(Math.min((room.w * share) / spanX, (room.h * (share - 0.04)) / spanY), this.home * least, this.home * most);
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k: this.limit(k) };
  }

  // Glides to a camera. `quick` for small steps (keyboard), so they don't feel slow.
  goTo(target, { quick = false } = {}) {
    this.wheel = null;
    this.camera.cancelAnimation();
    if (calm() || !this.world) {
      this.jumpTo(target);
      return;
    }
    const now = this.cameraNow();
    const room = this.room();
    const k = this.limit(target.k);
    const path = glide([now.x, now.y, room.w / now.k], [target.x, target.y, room.w / k]);
    const ms = quick ? 280 : clamp(420 + path.length * 280, 480, 1200);
    this.motion = { path, start: performance.now(), ms, width: room.w };
    this.kick();
  }

  fitAll() {
    if (this.world) this.goTo(this.fitCamera(null));
  }

  fitDots(indexes, options) {
    if (this.world && indexes.length) this.goTo(this.fitCamera(indexes, options));
  }

  // To a picked dot: it goes in the middle of what you can see, zoomed so that its nearest connected links fit
  // around it. (Some connected links can be on a far island; their lines still point the way.)
  flyToDot(index) {
    const { world } = this;
    if (!world) return;
    const room = this.room();
    // Enough of its closest links fit around it. One that lies very far away doesn't count: its line still points the way.
    const offsets = world.near[index]
      .map(({ index: other }) => ({ dx: Math.abs(world.x[other] - world.x[index]), dy: Math.abs(world.y[other] - world.y[index]) }))
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))
      .slice(0, 7);
    // (Never so far out that the dots crowd, and on a phone that means closer than "2 × the whole map".)
    const closest = Math.max(this.home * 5, 4500);
    let k = closest;
    for (const { dx, dy } of offsets) k = Math.min(k, (room.w * 0.46) / Math.max(dx, 1e-4), (room.h * 0.44) / Math.max(dy, 1e-4));
    this.goTo({ x: world.x[index], y: world.y[index], k: clamp(k, Math.max(this.home * 2, 1500), closest) });
  }

  // To a whole island: its main land fills what you can see.
  flyToIsland(category) {
    const island = this.world?.islandOf.get(category);
    if (!island) return;
    if (island.box) this.goTo(this.fitBox(island.box, { most: 7, least: 1, room: 0.8 }));
    else this.goTo({ x: island.x, y: island.y, k: this.home * 3 });
  }

  // Zooms by `factor` around a spot on screen (the middle when none is given).
  zoomBy(factor, at) {
    const spot = at ?? this.center();
    const now = this.motion ? this.motionEnd() : this.cameraNow();
    const k = this.limit(now.k * factor);
    const c = this.center();
    const mapX = (spot.x - c.x) / now.k + now.x;
    const mapY = (spot.y - c.y) / now.k + now.y;
    this.goTo({ x: mapX - (spot.x - c.x) / k, y: mapY - (spot.y - c.y) / k, k }, { quick: true });
  }

  panBy(dx, dy) {
    const now = this.cameraNow();
    this.goTo({ x: now.x + dx / now.k, y: now.y + dy / now.k, k: now.k }, { quick: true });
  }

  zoomTo(spotX, spotY, zoom) {
    this.goTo({ x: spotX, y: spotY, k: this.home * zoom });
  }

  motionEnd() {
    const [x, y, w] = this.motion.path.at(1);
    return { x, y, k: this.motion.width / w };
  }

  // A share across and down the map (from the small map in the corner): that spot goes in the middle of the view.
  centerOn(shareX, shareY, { smooth = false } = {}) {
    if (!this.world) return;
    const target = { x: shareX, y: shareY * this.world.aspect, k: this.cameraNow().k };
    if (smooth) this.goTo(target);
    else this.jumpTo(target);
  }

  // ---------- Mouse, touch and wheel ----------

  listen() {
    const { sigma, box } = this;
    // Sigma's own wheel zoom jumps in big steps. This one follows every small turn of the wheel or trackpad, so it
    // listens before Sigma does and keeps the wheel to itself.
    const onWheel = event => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.world) return;
      const rect = box.getBoundingClientRect();
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.h : 1;
      // A trackpad pinch arrives as a wheel with Ctrl held, in small steps: it gets a stronger factor.
      const factor = Math.exp(-event.deltaY * lines * (event.ctrlKey ? 0.011 : 0.0021));
      this.motion = null;
      this.camera.cancelAnimation();
      const target = this.limit((this.wheel?.target ?? this.cameraNow().k) * factor);
      this.wheel = { target, at };
      this.on.moved?.();
      this.kick();
    };
    // Any press on the map stops a glide in progress: the map is yours again.
    const onDown = () => {
      this.motion = null;
      this.wheel = null;
      this.on.moved?.();
    };
    box.addEventListener('wheel', onWheel, { passive: false, capture: true });
    box.addEventListener('pointerdown', onDown, true);

    sigma.on('clickNode', ({ event }) => this.clicked(event));
    sigma.on('clickStage', ({ event }) => this.clicked(event));
    sigma.on('doubleClickNode', ({ event }) => event.preventSigmaDefault()); // a double click on a dot is a pick, not a zoom
    sigma.on('doubleClickStage', () => clearTimeout(this.landClick));
    sigma.on('moveBody', ({ event }) => this.pointing(event));
    sigma.on('leaveStage', () => this.setHover(-1));
    sigma.on('afterRender', () => this.paint());
    sigma.on('resize', () => this.sizeLayers());
    this.unlisten = () => {
      box.removeEventListener('wheel', onWheel, { capture: true });
      box.removeEventListener('pointerdown', onDown, true);
    };
  }

  // The pointer moved. The dot nearest to it counts as "under" it, if it's close enough: easier than hitting a small dot
  // exactly, and it can never be the wrong one of two dots side by side. (Sigma could tell too, from its own picture of
  // the dots, but only which one lies on top.) Over an island's name, the pointer shows that it can be clicked.
  pointing(event) {
    const original = event.original;
    if (original?.pointerType === 'touch' || original?.touches) return;
    const layer = this.sigma.getMouseLayer();
    if (original?.target !== layer || this.motion || this.sigma.getGraphState().isPanning) {
      this.setHover(-1);
      layer.style.cursor = '';
      return;
    }
    const index = this.dotAt(event.x, event.y, HOVER_REACH);
    this.setHover(index);
    layer.style.cursor = index >= 0 || this.overlay.nameAt(event.x, event.y) ? 'pointer' : '';
  }

  // A click on the map: on a dot it picks the dot, on a name or on land it picks that island, on the sea it lets go of
  // what's picked.
  clicked(event) {
    const { x, y } = event;
    const original = event.original;
    const touch = Boolean(original?.touches || original?.changedTouches) || original?.pointerType === 'touch';
    clearTimeout(this.landClick);
    // A fingertip is bigger than a dot: a tap close to one counts.
    const index = this.dotAt(x, y, touch ? TAP_REACH : HOVER_REACH);
    if (index >= 0) {
      this.on.pick(index);
      return;
    }
    const name = this.overlay.nameAt(x, y);
    if (name) {
      this.on.pickIsland(name);
      return;
    }
    const category = this.land.hit(this.view, x, y);
    if (!category) {
      this.on.clear();
      return;
    }
    // On land the click waits a moment: it may be the first half of a double click (a zoom).
    this.landClick = setTimeout(() => this.on.pickIsland(category), DOUBLE_CLICK + 10);
  }

  // The dot nearest to a spot on screen, within `reach` pixels, or -1.
  dotAt(x, y, reach) {
    const { world, sx, sy } = this;
    if (!world) return -1;
    let best = -1;
    let bestDistance = reach * reach;
    for (let i = 0; i < world.n; i++) {
      const dx = sx[i] - x;
      const dy = sy[i] - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  setHover(index) {
    if (index === this.hover) return;
    const before = this.hover;
    this.hover = index;
    this.restyle([before, index], { sameLayer: true });
    this.tellHover();
  }

  tellHover() {
    if (this.hover < 0) this.on.hover(-1, 0, 0);
    else this.on.hover(this.hover, this.sx[this.hover], this.sy[this.hover]);
  }

  // ---------- The lines ----------

  // The picked dot's lines to its closest links (thicker = more alike). (The dot under the mouse has faint lines too.
  // They come and go quickly while the mouse moves, so they are drawn in overlay.js, which is much lighter than changing
  // Sigma's graph every time.)
  drawLines() {
    const { graph, world } = this;
    if (!world) return;
    graph.clearEdges();
    if (this.focus < 0) return;
    // Half of the thickness is how alike they really are, half how they compare with the others in this list, because
    // most closest links are about equally alike and the lines would all look the same.
    const values = this.near.map(item => item.alike);
    const lowest = Math.min(...values);
    const span = Math.max(Math.max(...values) - lowest, 0.01);
    this.near.forEach(({ index, alike }, place) => {
      if (index === this.focus) return;
      const strength = clamp((alike - 0.3) / 0.55, 0, 1) * 0.5 + ((alike - lowest) / span) * 0.5;
      // Lines bend one way and the other by turn, so they fan out instead of lying on top of each other.
      graph.addEdge(world.ids[this.focus], world.ids[index], { size: 1.1 + strength * 3.3, opacity: 0.92, curvature: place % 2 ? 0.14 : -0.14 });
    });
  }

  // ---------- How each dot looks ----------

  dotLook(i, data) {
    const { colors, world } = this;
    if (!colors) return data;
    const category = world.category[i];
    const color = rgba(colors.hue.get(category) ?? colors.muted);
    const ringColor = rgba(colors.ring);
    const scale = this.dotScale;
    // (The first pixel of a dot's size goes to its soft edge, so only the rest is scaled.)
    const base = 1 + (DOT_SIZES[world.size[i]] - 1) * scale;
    const thin = Math.max(0.55, 1.05 * scale);
    const lit = this.lit?.has(i);
    const pointedAt = i === this.preview || i === this.hover;
    // The picked dot, its closest links and search results lie on the top layer, above all other dots.
    if (i === this.focus) return { size: base + 5, color, ringColor, ringWidth: 2.4, keep: 1, depth: 'topNodes' };
    if (this.nearSet.has(i)) return { size: base + (pointedAt ? 3.2 : 2), color, ringColor, ringWidth: 1.5, keep: 1, depth: 'topNodes' };
    if (lit) return { size: base + (pointedAt ? 3.2 : 2.4), color, ringColor, ringWidth: 1.6, keep: 1, depth: 'topNodes' };
    if (pointedAt) return { size: base + 3, color, ringColor, ringWidth: 1.8, keep: 1 };
    // Dots of the island that stands out stay bright.
    const standOut = this.pointed || this.island;
    if (standOut && category === standOut && this.focus < 0 && !this.lit) return { size: base + 0.5, color, ringColor, ringWidth: thin, keep: 1 };
    return { size: base, color, ringColor, ringWidth: thin, keep: 0 };
  }

  // Sigma asks dotLook again for every dot (a new theme, or new sizes).
  refreshDots() {
    if (!this.world) return;
    this.sigma.refresh({ schedule: true });
    this.landKey = '';
  }

  // Sigma asks dotLook again for just these dots: quick, even if it happens many times a second. `sameLayer` when none of
  // them moves to another layer (above or among the other dots), which spares Sigma from sorting all dots again.
  restyle(indexes, { sameLayer = false } = {}) {
    const { world } = this;
    if (!world) return;
    const nodes = [...new Set(indexes)].filter(i => i >= 0).map(i => world.ids[i]);
    if (nodes.length) this.sigma.refresh({ partialGraph: { nodes }, skipIndexation: sameLayer, schedule: true });
    else this.sigma.scheduleRender();
  }

  // ---------- Frames ----------

  // Asks for a frame of our own moves (glides, wheel, fades). Sigma draws after every camera change.
  kick() {
    if (!this.raf) this.raf = requestAnimationFrame(now => this.step(now));
  }

  paintSoon() {
    this.landKey = '';
    this.sigma.scheduleRender();
  }

  step(now) {
    this.raf = 0;
    let busy = false;
    if (this.motion) {
      const t = Math.min((now - this.motion.start) / this.motion.ms, 1);
      const [x, y, width] = this.motion.path.at(easeInOut(Math.max(t, 0)));
      this.camera.setState(this.toSigma({ x, y, k: this.motion.width / width }));
      if (t >= 1) this.motion = null;
      else busy = true;
    }
    if (this.wheel) {
      // Each frame goes a third of the way to the wanted zoom, keeping the spot under the mouse in place.
      const { target, at } = this.wheel;
      const cam = this.cameraNow();
      const k = calm() ? target : Math.exp(Math.log(cam.k) + (Math.log(target) - Math.log(cam.k)) * 0.3);
      const c = this.center();
      const mapX = (at.x - c.x) / cam.k + cam.x;
      const mapY = (at.y - c.y) / cam.k + cam.y;
      this.camera.setState(this.toSigma({ x: mapX - (at.x - c.x) / k, y: mapY - (at.y - c.y) / k, k }));
      if (Math.abs(Math.log(target / k)) < 0.002) this.wheel = null;
      else busy = true;
    }
    // The fades: everything else receding, an island standing out.
    const elapsed = Math.min(now - (this.lastStep || now), 50);
    this.lastStep = now;
    const speed = calm() ? 1 : elapsed / 200;
    if (this.dim !== this.dimGoal) {
      this.dim = this.dim < this.dimGoal ? Math.min(this.dimGoal, this.dim + speed) : Math.max(this.dimGoal, this.dim - speed);
      this.recedeAmount.value = this.dim * 0.74;
      this.sigma.scheduleRender();
      if (this.dim !== this.dimGoal) busy = true;
    }
    if (this.glow !== this.glowGoal) {
      this.glow = this.glow < this.glowGoal ? Math.min(this.glowGoal, this.glow + speed) : Math.max(this.glowGoal, this.glow - speed);
      if (this.glow !== this.glowGoal) busy = true;
      this.sigma.scheduleRender();
    }
    if (busy) this.kick();
    else this.lastStep = 0;
  }

  sizeLayers() {
    const { width, height } = this.sigma.getDimensions();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.land.resize(width, height, dpr);
    this.overlay.resize(width, height, dpr);
    const before = this.world && this.w ? this.cameraNow() : null;
    this.w = width;
    this.h = height;
    this.landKey = '';
    if (!this.world) return;
    // Same spot in the middle and the same zoom compared to "whole map", so turning a phone keeps your place.
    const zoom = before ? before.k / this.home : 1;
    this.measure();
    this.setBoundaries();
    if (before) this.jumpTo({ x: before.x, y: before.y, k: this.home * zoom });
  }

  dotRadius = i => {
    const data = this.sigma.getNodeDisplayData(this.world.ids[i]);
    return Math.max((data?.size ?? 4) * this.sizeScale - 1, 1);
  };

  // Paints the land and the names for this frame, right after Sigma has drawn the dots.
  paint() {
    const { world, colors, sigma } = this;
    if (!world || !colors || !this.w) return;
    const now = performance.now();
    const a = sigma.graphToViewport({ x: 0, y: 0 });
    const b = sigma.graphToViewport({ x: 1, y: 0 });
    const k = b.x - a.x;
    const view = { k, ox: a.x, oy: a.y, z: k / this.home };
    this.view = view;
    this.sizeScale = 1 / this.sigma.getSetting('zoomToSizeRatioFunction')(this.camera.ratio);
    for (let i = 0; i < world.n; i++) {
      this.sx[i] = view.ox + world.x[i] * k;
      this.sy[i] = view.oy + world.y[i] * k;
    }

    // The land only when something changed: names fading don't need it.
    const look = { dim: this.dim * (this.focus >= 0 || this.lit ? 0.72 : 0.8), picked: this.glowCategory, glow: this.glow };
    const key = `${k.toFixed(3)}|${view.ox.toFixed(2)}|${view.oy.toFixed(2)}|${look.dim.toFixed(3)}|${look.picked}|${look.glow.toFixed(3)}`;
    if (key !== this.landKey) {
      this.landKey = key;
      this.land.draw(view, look, Boolean(this.motion));
      // Once nothing has moved for a moment, the land is painted sharp again.
      clearTimeout(this.sharpenTimer);
      this.sharpenTimer = setTimeout(() => this.land.sharpen(), 130);
    }

    const busy = this.overlay.draw(
      {
        world,
        colors,
        view,
        focus: this.focus,
        focusSince: this.focusSince,
        near: this.near,
        nearSet: this.nearSet,
        lit: this.lit,
        hover: this.hover,
        preview: this.preview,
        picked: this.island,
        dim: this.dim,
        covered: this.covered,
        dotRadius: this.dotRadius,
        sx: this.sx,
        sy: this.sy,
      },
      now,
    );
    this.drawMini(view);
    if (this.hover >= 0) this.tellHover();
    if (busy) sigma.scheduleRender();
  }

  // ---------- The small map in the corner ----------

  drawMini(view) {
    const canvas = this.miniCanvas;
    const { world, colors, land } = this;
    if (!canvas || !world || !land.coast) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const key = `${width}x${height}x${dpr}`;
    if (!this.miniPicture || this.miniPicture.key !== key) {
      // The land in its colors, painted once.
      const picture = document.createElement('canvas');
      picture.width = width * dpr;
      picture.height = height * dpr;
      const ctx = picture.getContext('2d');
      const unit = (width * dpr) / land.scale;
      ctx.setTransform(unit, 0, 0, unit, 0, 0);
      ctx.fillStyle = rgba(colors.land);
      ctx.fill(land.coast, 'evenodd');
      for (const { category, path } of land.countries) {
        ctx.fillStyle = rgba(colors.tint.get(category) ?? colors.land);
        ctx.fill(path, 'evenodd');
      }
      ctx.strokeStyle = rgba(colors.coast);
      ctx.lineWidth = 1 / unit;
      ctx.stroke(land.coast);
      this.miniPicture = { key, picture };
      if (canvas.width !== width * dpr) canvas.width = width * dpr;
      if (canvas.height !== height * dpr) canvas.height = height * dpr;
      this.miniKey = '';
    }
    const miniKey = `${view.k.toFixed(2)}|${view.ox.toFixed(1)}|${view.oy.toFixed(1)}|${this.w}|${this.h}`;
    if (miniKey === this.miniKey) return;
    this.miniKey = miniKey;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(this.miniPicture.picture, 0, 0, width, height);
    // The rectangle of what you can see right now. (When you see the whole map, it needs no rectangle.)
    const { left: leftInset, right, top: topInset, bottom } = this.insets;
    const left = ((leftInset - view.ox) / view.k) * width;
    const top = ((topInset - view.oy) / view.k) * width;
    const across = ((this.w - leftInset - right) / view.k) * width;
    const down = ((this.h - topInset - bottom) / view.k) * width;
    if (left <= 1 && top <= 1 && left + across >= width - 1 && top + down >= height - 1) return;
    ctx.fillStyle = rgba(colors.accent, 0.16);
    ctx.fillRect(left, top, across, down);
    ctx.strokeStyle = rgba(colors.accent, 0.95);
    ctx.lineWidth = 1.25;
    ctx.strokeRect(left, top, across, down);
  }
}
