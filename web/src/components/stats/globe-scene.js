// The 3D Earth of the "Origins" card, drawn with globe.gl (which sits on three.js). This file and all it brings along
// is heavy, so globe.jsx loads it only when the card comes near the screen: the rest of the site never waits for it.
//
// How the Earth is made:
// - The ground is one sphere with its own small program for the graphics card (EARTH_SHADER below). It mixes NASA's
//   daytime photo, the city lights of the night side, mountains, shiny water and slowly drifting clouds.
// - The sun stands still next to the camera, so turning the globe is like the real Earth turning under the sun: one
//   edge is always in soft daylight and the other slides into night, where the city lights come on.
// - A thin shell around it (AIR_SHADER) is the atmosphere: a soft glow, brighter on the sunny side.
// - Countries with links are raised and colored (the polygons layer of globe.gl). Countries too small to see or click
//   get a small glowing dot instead.
//
// It draws only while something moves: when the globe stands still it rests, and it wakes at the first touch.
//
// The mouse and fingers: what is under the pointer is worked out here with plain math (pickAt), not by asking
// globe.gl. Its own events lose a click when the mouse moves one pixel, and on a phone the tap after a scroll.
import Globe from 'globe.gl';
import {
  AdditiveBlending, AmbientLight, BackSide, BufferGeometry, CanvasTexture, Color, DirectionalLight, DoubleSide, Float32BufferAttribute, Group,
  LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshLambertMaterial, Plane, RepeatWrapping, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial,
  SRGBColorSpace, TextureLoader, Vector3,
} from 'three';
import { feature, mesh } from 'topojson-client';
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import world from 'world-atlas/countries-50m.json';
import { BY_NAME, ISO_CODES, SMALL } from '../country-codes.js';
import { cssColor as rgba, scaleColor, scaleOf } from './globe-colors.js';

const PICTURES = '/globe/'; // web/public/globe: small copies of the NASA pictures that ship with three-globe
const FOV = 50; // how wide the camera sees (three.js's default, which globe.gl keeps), in degrees
const HOME = { lat: 28, lng: -46 }; // where the globe starts: the Atlantic, with America on one side and Europe on the other
const SPIN_SPEED = 0.42; // the slow turning before the first touch (three.js's own unit: 2 is one turn in 30 seconds)
const DRAG_LIMIT = 6; // a press that moves more pixels than this is a drag, not a click
const DOT_HIT = 12; // how near a dot the pointer must be (pixels)
const TINY_AREA = 0.0012; // countries smaller than this (about 48,000 km²: Cyprus, Israel, Taiwan) can also be picked from just beside them
const TINY_HIT = 9; // how near (pixels)
const PULSE_TIME = 1900; // one ring spreading out from the picked country (milliseconds)
const PULSES = 3; // how many rings, then it is calm again while you read
const CLOUD_SPEED = 2.4e-7; // how fast the clouds drift around the Earth (turns per millisecond: once in over an hour)
const REST_AFTER = 2500; // nothing moved for this long (milliseconds): stop drawing until something happens, for the fans and the battery
const MIN_ISLAND = 0.00015; // islands smaller than this (about 6,000 km²) are left out: too small to see, and each one costs time
const AIR_THICKNESS = 0.13; // how far the atmosphere reaches, in Earth radii
const OUTLINE_STEP = 0.2; // points of a coastline nearer than this (degrees, about 20 km) to the one before are left out: half a pixel

// ---------- The two small programs for the graphics card ----------

const SPHERE_VERTEX = `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vPosW = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_SHADER = `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D reliefMap;
  uniform sampler2D waterMap;
  uniform sampler2D cloudMap;
  uniform vec3 sunDir;
  uniform vec3 hazeColor;
  uniform vec3 shadeColor;
  uniform float drift;
  uniform float sunPower;
  uniform float nightPower;
  uniform float hazePower;
  uniform float hazeFloor;
  uniform float cloudPower;
  uniform float glintPower;
  uniform float reliefPower;
  uniform float exposure;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  float cloudAt(vec2 uv) {
    return smoothstep(0.06, 0.9, texture2D(cloudMap, uv).r);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = sunDir;
    float sun = dot(N, L);

    // Mountains: the ground's height tilts the light a little, from the height map's slope east and north.
    vec3 east = normalize(vec3(N.z + 0.00001, 0.0, -N.x));
    vec3 north = cross(N, east);
    vec2 texel = vec2(1.0 / 2048.0, 1.0 / 1024.0);
    float height = texture2D(reliefMap, vUv).r;
    float slopeE = texture2D(reliefMap, vUv + vec2(texel.x, 0.0)).r - height;
    float slopeN = texture2D(reliefMap, vUv + vec2(0.0, texel.y)).r - height;
    vec3 ground = normalize(N - reliefPower * (slopeE * east + slopeN * north));

    // Clouds drift slowly by themselves, and each one drops a soft shadow a little away from the sun.
    vec2 cloudUv = vec2(vUv.x + drift, vUv.y);
    float cloud = cloudAt(cloudUv) * cloudPower;
    float cloudShadow = cloudAt(cloudUv - vec2(dot(L, east), dot(L, north)) * 0.004) * cloudPower;

    // Daylight: from no light (night) to full sun, with a wide soft edge between them.
    float day = smoothstep(-0.16, 0.3, sun);
    float light = clamp((dot(ground, L) + 0.1) / 1.1, 0.0, 1.0);
    float water = texture2D(waterMap, vUv).r;
    vec3 albedo = texture2D(dayMap, vUv).rgb;
    albedo = mix(albedo, albedo * 1.2 + vec3(0.0, 0.012, 0.032), water); // the photo's deep sea is nearly black: a little more blue
    vec3 color = albedo * (shadeColor + sunPower * light * (1.0 - 0.5 * cloudShadow));

    // The sun's shine on water: a small warm spot and a wide faint blue one. Land has none.
    float toSun = max(dot(N, normalize(L + V)), 0.0);
    color += water * glintPower * day * (1.0 - cloud) * (vec3(1.0, 0.93, 0.8) * pow(toSun, 300.0) * 0.12 + vec3(0.3, 0.5, 0.78) * pow(toSun, 42.0) * 0.035);

    // The night side: where the sun has gone the land glows faintly blue and the city lights come on, warm and bright
    // (they are the parts of the night photo that are more red than blue). Clouds dim them.
    vec3 night = texture2D(nightMap, vUv).rgb;
    float cities = smoothstep(0.01, 0.16, night.r - night.b * 0.4);
    color += (night * 0.3 + vec3(1.0, 0.72, 0.38) * cities * nightPower) * (1.0 - day) * (1.0 - 0.7 * cloud);

    // Clouds lie over all of that, lit by the same sun.
    color = mix(color, vec3(0.93, 0.95, 1.0) * (0.012 + 1.15 * light), cloud);

    // A warm line where day meets night, like the real sunset.
    float dusk = smoothstep(-0.12, 0.06, sun) * (1.0 - smoothstep(0.06, 0.34, sun));
    color *= 1.0 + dusk * vec3(0.42, 0.04, -0.18);

    // The air: near the edge of the globe you look through a lot of it, so the ground fades into blue.
    float edge = 1.0 - max(dot(N, V), 0.0);
    float air = clamp(pow(edge, 3.0) * hazePower, 0.0, 1.0);
    color = mix(color, hazeColor * (hazeFloor + 1.05 * smoothstep(-0.2, 0.7, sun)), air);

    // Like a camera: bright parts roll off softly instead of burning out to flat white.
    color = 1.0 - exp(-color * exposure);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const AIR_SHADER = `
  uniform vec3 sunDir;
  uniform vec3 airColor;
  uniform float radius;
  uniform float thickness;
  uniform float strength;
  uniform float nightGlow;
  varying vec3 vPosW;

  void main() {
    vec3 V = normalize(cameraPosition - vPosW);
    // The point of this line of sight nearest to the Earth's middle: how high above the ground it passes.
    vec3 nearest = vPosW - V * dot(vPosW, V);
    float h = clamp((length(nearest) - radius) / thickness, 0.0, 1.0);
    // Air gets thin fast with height, and it ends at the top of the shell.
    float density = exp(-h * 3.6) * (1.0 - h) * (1.0 - h);
    float sunny = smoothstep(-0.5, 0.7, dot(normalize(nearest), sunDir));
    gl_FragColor = vec4(airColor, density * mix(nightGlow, 1.0, sunny) * strength);
    #include <colorspace_fragment>
  }
`;

// What differs between the light and the dark theme.
// sunAt: where the sun stands as seen from the camera (right, up, toward you).
const LOOKS = {
  light: {
    sunAt: [-0.42, 0.42, 0.8], shade: [0.2, 0.23, 0.3], sunPower: 1.3, nightPower: 0.5, hazePower: 0.7, cloudPower: 0.72, glintPower: 0.7,
    reliefPower: 5, exposure: 1.45, haze: '#9cc9ff', hazeFloor: 0.3, air: '#57a3ff', airStrength: 0.66, nightGlow: 0.5, border: 0.1,
    capLight: 0.72, capSun: 0.46,
  },
  dark: {
    sunAt: [-0.82, 0.38, 0.42], shade: [0.022, 0.03, 0.05], sunPower: 1.7, nightPower: 1.3, hazePower: 0.78, cloudPower: 0.78, glintPower: 1,
    reliefPower: 6, exposure: 1.4, haze: '#68adff', hazeFloor: 0.03, air: '#4a9bff', airStrength: 0.85, nightGlow: 0.16, border: 0.085,
    capLight: 0.55, capSun: 0.68,
  },
};

// The accent color of the page, as [red, green, blue], read from the theme's variable.
function accentColor() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const color = new Color();
  try {
    color.setStyle(raw || '#6458ee', 'srgb');
  } catch {
    color.set('#6458ee');
  }
  const { r, g, b } = color.convertLinearToSRGB();
  return [r, g, b].map(value => Math.round(value * 255));
}

// ---------- The countries: shapes, middles and how big they are ----------

// Fewer points on a coastline, the same look: everything after this gets much faster.
function lighterRing(ring) {
  if (ring.length <= 8) return ring;
  const kept = [ring[0]];
  let [lastLng, lastLat] = ring[0];
  for (let i = 1; i < ring.length - 1; i++) {
    const [lng, lat] = ring[i];
    const across = (lng - lastLng) * Math.cos((lat * Math.PI) / 180);
    if (across * across + (lat - lastLat) * (lat - lastLat) >= OUTLINE_STEP * OUTLINE_STEP) {
      kept.push(ring[i]);
      lastLng = lng;
      lastLat = lat;
    }
  }
  kept.push(ring[ring.length - 1]);
  return kept.length >= 4 ? kept : ring;
}

// A piece of land that crosses the date line (Russia!) takes the shape builder a whole second: it uses a very slow
// method for those. So it is cut in two along the line, which is invisible, and each half takes a few milliseconds.
function cutAtDateLine(ring) {
  const parts = [[]];
  let crossings = 0;
  ring.forEach((point, i) => {
    const before = ring[i - 1];
    if (before && Math.abs(point[0] - before[0]) > 180) {
      crossings++;
      const edge = before[0] > 0 ? 179.99 : -179.99;
      const after = point[0] + (before[0] > 0 ? 360 : -360);
      const lat = before[1] + ((point[1] - before[1]) * (edge - before[0])) / (after - before[0]);
      parts.at(-1).push([edge, lat]);
      parts.push([[-edge, lat]]);
    }
    parts.at(-1).push(point);
  });
  if (crossings !== 2) return [ring]; // anything less simple keeps the slow way: still right, only slower
  const [start, middle, end] = parts;
  const one = [...end, ...start.slice(1)];
  return [[...one, one[0]], [...middle, middle[0]]];
}

// Every country once: { code, geometry, center: { lat, lng }, area, bounds }. Worked out once per visit.
let shapes = null;
function countryShapes() {
  if (shapes) return shapes;
  const parts = new Map(); // code → the pieces of land of that country
  for (const country of feature(world, world.objects.countries).features) {
    const code = ISO_CODES[country.id] ?? BY_NAME[country.properties.name] ?? '';
    if (!code || code === 'AQ') continue; // Antarctica has no companies, and its huge shape only costs time
    const polygons = country.geometry.type === 'Polygon' ? [country.geometry.coordinates] : country.geometry.coordinates;
    if (!parts.has(code)) parts.set(code, []);
    parts.get(code).push(...polygons.map(coordinates => ({ coordinates, area: geoArea({ type: 'Polygon', coordinates }) })));
  }
  shapes = new Map();
  for (const [code, pieces] of parts) {
    const biggest = pieces.reduce((best, piece) => (piece.area > best.area ? piece : best));
    const kept = pieces.filter(piece => piece === biggest || piece.area >= MIN_ISLAND);
    const coordinates = kept.flatMap(piece =>
      // (A piece with lakes cut out of it stays whole: none of those cross the date line.)
      piece.coordinates.length === 1 ? cutAtDateLine(lighterRing(piece.coordinates[0])).map(ring => [ring]) : [piece.coordinates.map(lighterRing)],
    );
    const geometry = { type: 'MultiPolygon', coordinates };
    // The middle of its biggest piece: the middle of all of America would lie far up in Canada, because of Alaska.
    const [lng, lat] = geoCentroid({ type: 'Polygon', coordinates: biggest.coordinates });
    shapes.set(code, { code, geometry, center: { lat, lng }, area: kept.reduce((sum, piece) => sum + piece.area, 0), bounds: geoBounds(geometry) });
  }
  return shapes;
}

// Countries that are not on the map, as dots: Singapore, Hong Kong, Bahrain, Malta…
const SMALL_PLACES = new Map(SMALL.map(([code, lng, lat]) => [code, { lat, lng }]));

const insideBounds = ([[west, south], [east, north]], lng, lat) =>
  lat >= south - 0.2 && lat <= north + 0.2 && (west <= east ? lng >= west - 0.2 && lng <= east + 0.2 : lng >= west - 0.2 || lng <= east + 0.2);

// The fine lines between all countries, as one drawing: cheap for the graphics card, however many there are.
function borderLines(globe) {
  const lines = mesh(world, world.objects.countries, (a, b) => a !== b);
  const positions = [];
  for (const line of lines.coordinates) {
    const points = lighterRing(line);
    for (let i = 1; i < points.length; i++) {
      const a = globe.getCoords(points[i - 1][1], points[i - 1][0], 0.0012);
      const b = globe.getCoords(points[i][1], points[i][0], 0.0012);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return new LineSegments(geometry, new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
}

// A round soft glow to paint the small countries' dots with.
function glowPicture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const paint = canvas.getContext('2d');
  const glow = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.2, 'rgba(255,255,255,1)');
  glow.addColorStop(0.27, 'rgba(255,255,255,0.5)');
  glow.addColorStop(0.5, 'rgba(255,255,255,0.16)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  paint.fillStyle = glow;
  paint.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// A soft ring, for the pulse around the picked country.
function ringPicture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const paint = canvas.getContext('2d');
  const ring = paint.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  ring.addColorStop(0.84, 'rgba(255,255,255,0)');
  ring.addColorStop(0.95, 'rgba(255,255,255,1)');
  ring.addColorStop(1, 'rgba(255,255,255,0)');
  paint.fillStyle = ring;
  paint.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// The raised countries melt away toward the edge of the Earth, where they would look like stacked slabs seen from the
// side. This adds that to three.js's own materials: `rim` says where the fading starts (see scene.onBeforeRender).
function fadeAtRim(material, rim) {
  material.onBeforeCompile = shader => {
    shader.uniforms.rimStart = rim;
    shader.vertexShader = `varying vec3 vSpot;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vSpot = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = `varying vec3 vSpot;\nuniform float rimStart;\n${shader.fragmentShader}`.replace(
      '#include <opaque_fragment>',
      'diffuseColor.a *= smoothstep(rimStart, rimStart + 0.16, dot(normalize(vSpot), normalize(cameraPosition)));\n#include <opaque_fragment>',
    );
  };
  return material;
}

// How high the camera must be for the Earth's disc to be `share` of the box's smaller side.
function altitudeFor(width, height, share) {
  const wanted = (share * Math.min(width, height)) / height;
  const s = wanted * Math.tan((FOV * Math.PI) / 360);
  return Math.sqrt(1 + s * s) / s - 1;
}

// ---------- The globe itself ----------

// container: the empty box for the canvas. values: { US: 231, … }. dark: the theme. calm: the visitor wants less motion.
// onHover(code | null), onMove(x, y), onPick(code) tell the page what the mouse does; onReady() comes when it can be shown.
export async function createEarth(container, { width, height, values, dark, calm, onHover, onMove, onPick, onReady }) {
  const globe = new Globe(container, { animateIn: false, rendererConfig: { antialias: true, alpha: true } })
    .width(width)
    .height(height)
    .backgroundColor('rgba(0,0,0,0)')
    .showAtmosphere(false)
    .enablePointerInteraction(false) // the mouse is handled below
    .polygonCapCurvatureResolution(6)
    .polygonsTransitionDuration(0)
    .polygonLabel(() => null);
  globe.pauseAnimation(); // nothing to draw until the pictures are here

  const renderer = globe.renderer();
  const camera = globe.camera();
  const scene = globe.scene();
  const controls = globe.controls();
  const canvas = renderer.domElement;
  const radius = globe.getGlobeRadius();

  // ----- The pictures -----
  const big = Math.max(width, height) * Math.min(2, window.devicePixelRatio || 1) > 1100; // phones get the smaller day photo
  const loader = new TextureLoader();
  const load = (name, photo) =>
    loader.loadAsync(`${PICTURES}${name}.webp`).then(async texture => {
      if (photo) texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      await texture.image.decode?.().catch(() => {}); // unpack the picture away from the page's main work
      return texture;
    });
  const [day, night, relief, water, clouds] = await Promise.all([
    load(big ? 'earth-day' : 'earth-day-small', true),
    load('earth-night', true),
    load('earth-relief'),
    load('earth-water'),
    load('earth-clouds'),
  ]).catch(failure => {
    globe._destructor(); // the page shows the flat map instead: leave nothing behind
    renderer.forceContextLoss();
    throw failure;
  });
  clouds.wrapS = RepeatWrapping; // they drift around the whole Earth, past the picture's edge

  // ----- The ground and the air -----
  const sunDir = new Vector3();
  const earth = new ShaderMaterial({
    vertexShader: SPHERE_VERTEX,
    fragmentShader: EARTH_SHADER,
    uniforms: {
      dayMap: { value: day }, nightMap: { value: night }, reliefMap: { value: relief }, waterMap: { value: water }, cloudMap: { value: clouds },
      sunDir: { value: sunDir }, hazeColor: { value: new Color() }, shadeColor: { value: new Color() }, drift: { value: 0 },
      sunPower: { value: 1 }, nightPower: { value: 1 }, hazePower: { value: 1 }, hazeFloor: { value: 0 }, cloudPower: { value: 1 }, glintPower: { value: 1 },
      reliefPower: { value: 1 }, exposure: { value: 1 },
    },
  });
  globe.globeMaterial(earth);

  const air = new Mesh(
    new SphereGeometry(radius * (1 + AIR_THICKNESS), 96, 64),
    new ShaderMaterial({
      vertexShader: SPHERE_VERTEX,
      fragmentShader: AIR_SHADER,
      side: BackSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        sunDir: { value: sunDir }, airColor: { value: new Color() }, radius: { value: radius },
        thickness: { value: radius * AIR_THICKNESS }, strength: { value: 1 }, nightGlow: { value: 0.2 },
      },
    }),
  );
  air.renderOrder = -1; // behind everything see-through
  scene.add(air);

  const borders = borderLines(globe);
  borders.renderOrder = 0;
  scene.add(borders);

  // ----- The sun: it stands still next to the camera, so it moves with it (see the top of this file) -----
  const sunAt = new Vector3();
  const roomLight = new AmbientLight(0xffffff, Math.PI);
  const sunLight = new DirectionalLight(0xffffff, Math.PI);
  globe.lights([roomLight, sunLight]); // these light the raised countries, the same way the ground is lit
  let lastCheck = 0;
  let pointer = null; // where a mouse is, while it is over the globe
  // Raised countries would peek over the edge of the Earth from behind it, as thin arcs floating in space. So everything
  // but the ground and the air (they opt out: they are our own programs) is cut off just before the horizon. The tops
  // and walls have already faded out by then (fadeAtRim), so only their thin outlines ever reach the cut.
  const horizon = new Plane(new Vector3(0, 0, 1), 0);
  renderer.clippingPlanes = [horizon];
  const rimStart = { value: 0.4 };
  // Drawing only when something moves: no spinning, no flight, no pulse and no mouse for a moment means it can rest (the
  // last picture simply stays on the screen). `seen` is the page saying the card can be seen at all.
  let seen = true;
  let resting = false;
  let busyUntil = 0;
  const wake = (forMs = 0) => {
    busyUntil = Math.max(busyUntil, performance.now() + forMs + REST_AFTER);
    if (resting && seen) {
      resting = false;
      globe.resumeAnimation();
    }
  };
  let lastFrame = 0;
  scene.onBeforeRender = () => {
    sunDir.copy(sunAt).transformDirection(camera.matrixWorld);
    sunLight.position.copy(sunDir).multiplyScalar(1000);
    const distance = camera.position.length();
    horizon.normal.copy(camera.position).divideScalar(distance);
    horizon.constant = -(radius * radius) / distance - radius * 0.14;
    rimStart.value = radius / distance + 0.06;
    const now = performance.now();
    if (!calm) earth.uniforms.drift.value = (earth.uniforms.drift.value + Math.min(now - lastFrame, 100) * CLOUD_SPEED) % 1;
    lastFrame = now;
    if (pulse.visible) {
      const age = now - pulseStart;
      const t = (age % PULSE_TIME) / PULSE_TIME;
      const size = 2 * pulseRadius * (0.25 + 0.75 * (1 - (1 - t) * (1 - t)));
      pulse.scale.set(size, size, 1);
      pulse.material.opacity = 0.8 * (1 - t) * (1 - t);
      if (age > PULSES * PULSE_TIME) pulse.visible = false;
    }
    // The globe can turn under a mouse that stands still.
    if (pointer && !pointer.pressed && now - lastCheck > 140) {
      lastCheck = now;
      hover(pickAt(pointer.x, pointer.y));
    }
    if (controls.autoRotate) busyUntil = now + REST_AFTER;
    if (now > busyUntil && !resting) {
      resting = true;
      // After this frame is done: globe.gl asks for its next frame right after drawing, which would undo a pause from here.
      setTimeout(() => {
        if (resting) globe.pauseAnimation();
      });
    }
  };

  // ----- The countries -----
  let accent = [100, 88, 238];
  let countries = []; // the ones with links: { code, count, t, altitude, geometry, center, area, bounds }, highest first
  let places = new Map(); // what can be flown to: code → { lat, lng, area }
  let dots = []; // the countries too small for a shape: { code, t, position, sprite }
  let selected = null;
  let hovered = null;
  let risen = false; // the countries rise out of the ground once the Earth is on screen
  let gone = false; // destroyed: a loop that is still running stops

  const dotGroup = new Group();
  scene.add(dotGroup);
  const dotPicture = glowPicture();
  const pulsePicture = ringPicture();
  const pulse = new Sprite(new SpriteMaterial({ map: pulsePicture, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  pulse.renderOrder = 4;
  pulse.visible = false;
  scene.add(pulse);
  let pulseRadius = 0;
  let pulseStart = 0;

  const baseAltitude = t => 0.006 + 0.024 * t;
  const altitudeOf = country => {
    if (!risen) return 0.003; // just above the ground at first (see the end of this function)
    if (country.code === selected) return country.altitude + 0.016;
    if (country.code === hovered) return country.altitude + 0.01;
    return country.altitude;
  };
  // Each country has its own see-through "glass" for the top, lit by the sun like the ground under it: a few links let
  // the land show through, many links are nearly solid. Only its color changes on hover.
  const capOf = country => {
    const material = (country.cap ??= fadeAtRim(new MeshLambertMaterial({ side: DoubleSide, transparent: true }), rimStart));
    const active = country.code === selected;
    const base = active ? accent : scaleColor(country.t);
    const color = !active && country.code === hovered ? base.map(value => Math.min(255, value + 34)) : base;
    material.color.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, SRGBColorSpace);
    material.opacity = active ? 0.84 : country.code === hovered ? 0.94 : 0.46 + 0.3 * country.t;
    return material;
  };
  // The walls are darker than the top. They don't hide each other (no depth), or their edges would flicker at the rim.
  const sideOf = country => {
    const material = (country.wall ??= fadeAtRim(new MeshBasicMaterial({ side: DoubleSide, transparent: true, depthWrite: false, opacity: 0.55 }), rimStart));
    const base = country.code === selected ? accent : scaleColor(country.t);
    material.color.setRGB((base[0] / 255) * 0.6, (base[1] / 255) * 0.6, (base[2] / 255) * 0.6, SRGBColorSpace);
    return material;
  };
  const strokeOf = country => {
    if (country.code === selected || country.code === hovered) return 'rgba(255,255,255,0.92)';
    return rgba(scaleColor(country.t).map(value => Math.min(255, value + 46)), 0.55 + 0.35 * country.t);
  };

  // The accent, a little lighter: on a dark sea a glow in the deep accent color would hardly show.
  const brightAccent = () => accent.map(value => Math.round(value + (255 - value) * 0.35));
  const paintDots = () => {
    const glow = brightAccent();
    pulse.material.color.setRGB(glow[0] / 255, glow[1] / 255, glow[2] / 255, SRGBColorSpace);
    for (const dot of dots) {
      const color = dot.code === selected ? glow : scaleColor(dot.t);
      dot.sprite.material.color.setRGB(color[0] / 255, color[1] / 255, color[2] / 255, SRGBColorSpace);
      // A size in pixels, the same however far the camera is: three.js counts this kind of sprite in its own unit.
      const pixels = dot.code === selected || dot.code === hovered ? 40 : 28;
      const size = (2 * pixels * Math.tan((FOV * Math.PI) / 360)) / (globe.height() || 1);
      dot.sprite.scale.set(size, size, 1);
    }
  };

  // Hover and selection changed: only the looks are worked out again, not the shapes.
  const repaint = () => {
    globe.polygonAltitude(altitudeOf).polygonCapMaterial(capOf).polygonSideMaterial(sideOf).polygonStrokeColor(strokeOf);
    paintDots();
  };

  const setValues = next => {
    wake(1500);
    const all = countryShapes();
    const entries = Object.entries(next).filter(([, count]) => count > 0);
    const most = Math.max(1, ...entries.map(([, count]) => count));

    countries = entries
      .filter(([code]) => all.has(code))
      .map(([code, count]) => {
        const t = scaleOf(count, most);
        const old = countries.find(country => country.code === code); // keep its materials and its place on the globe
        return { ...all.get(code), ...old, count, t, altitude: baseAltitude(t) };
      })
      .sort((a, b) => b.altitude - a.altitude);

    for (const dot of dots) dot.sprite.material.dispose();
    dotGroup.clear();
    dots = [];
    places = new Map(countries.map(country => [country.code, { ...country.center, area: country.area }]));
    for (const [code, count] of entries) {
      const place = SMALL_PLACES.get(code);
      if (!place || all.has(code)) continue;
      const { x, y, z } = globe.getCoords(place.lat, place.lng, 0.03);
      const sprite = new Sprite(
        new SpriteMaterial({ map: dotPicture, transparent: true, depthWrite: false, blending: AdditiveBlending, sizeAttenuation: false }),
      );
      sprite.position.set(x, y, z);
      sprite.renderOrder = 3;
      dotGroup.add(sprite);
      dots.push({ code, t: scaleOf(count, most), position: sprite.position.clone(), sprite });
      places.set(code, { ...place, area: 0 });
    }
    repaint();
    // One country at a time with a small pause between, so the page keeps moving while the shapes are built.
    const fed = new Set(countries.filter(country => country.__id).map(country => country.code));
    return new Promise(done => {
      const next = () => {
        if (gone) return done();
        const more = countries.find(country => !fed.has(country.code));
        if (more) fed.add(more.code);
        globe.polygonsData(countries.filter(country => fed.has(country.code)));
        if (more) setTimeout(next, 16);
        else done();
        return undefined;
      };
      next();
    });
  };

  // ----- What is under the pointer: plain math, on the raised height of each country -----
  const ray = new Vector3();
  const spot = new Vector3();
  const onScreen = (position, out) => {
    out.copy(position).project(camera);
    return { x: ((out.x + 1) / 2) * globe.width(), y: ((1 - out.y) / 2) * globe.height() };
  };
  function pickAt(x, y) {
    const from = camera.position;
    const distance = from.length();
    // Dots first: they are tiny, and they sit on top of everything.
    let nearest = null;
    let best = DOT_HIT;
    for (const dot of dots) {
      // Only on the side of the Earth that faces the camera.
      if (dot.position.dot(from) / (dot.position.length() * distance) < radius / distance) continue;
      const at = onScreen(dot.position, spot);
      const away = Math.hypot(at.x - x, at.y - y);
      if (away < best) {
        best = away;
        nearest = dot.code;
      }
    }
    if (nearest) return nearest;

    // The line of sight through this pixel.
    ray.set((x / globe.width()) * 2 - 1, 1 - (y / globe.height()) * 2, 0.5).unproject(camera).sub(from).normalize();
    const along = from.dot(ray);
    const clear = from.dot(from);
    for (const country of countries) {
      // Where that line meets a sphere as high as this country is raised.
      const top = radius * (1 + altitudeOf(country));
      const inside = along * along - clear + top * top;
      if (inside < 0) continue;
      const t = -along - Math.sqrt(inside);
      const px = from.x + ray.x * t;
      const py = from.y + ray.y * t;
      const pz = from.z + ray.z * t;
      const lat = (Math.asin(py / top) * 180) / Math.PI;
      const lng = (Math.atan2(px, pz) * 180) / Math.PI;
      if (insideBounds(country.bounds, lng, lat) && geoContains(country.geometry, [lng, lat])) return country.code;
    }
    // Just beside a tiny country counts too: it can be only a few pixels wide.
    best = TINY_HIT;
    for (const country of countries) {
      if (country.area >= TINY_AREA) continue;
      const { x: cx, y: cy, z: cz } = globe.getCoords(country.center.lat, country.center.lng, country.altitude);
      spot.set(cx, cy, cz);
      if (spot.dot(from) / (spot.length() * distance) < radius / distance) continue;
      const at = onScreen(spot, spot);
      const away = Math.hypot(at.x - x, at.y - y);
      if (away < best) {
        best = away;
        nearest = country.code;
      }
    }
    return nearest;
  }

  const hover = code => {
    if (code === hovered) return;
    hovered = code;
    canvas.style.cursor = code ? 'pointer' : 'grab';
    repaint();
    onHover(code);
  };

  // ----- The mouse and fingers -----
  let press = null;
  const local = event => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const onPointerDown = event => {
    wake();
    if (event.button !== 0) return;
    press = { ...local(event), id: event.pointerId, moved: false };
    if (pointer) pointer.pressed = true;
    stopSpinning();
  };
  const onPointerMove = event => {
    wake();
    const { x, y } = local(event);
    if (press && press.id === event.pointerId && Math.hypot(x - press.x, y - press.y) > DRAG_LIMIT) {
      press.moved = true;
      if (pointer) hover(null); // dragging: no label under the moving mouse
    }
    if (event.pointerType !== 'mouse') return; // a finger has no "hover"
    pointer = { x, y, pressed: Boolean(press) };
    onMove(x, y);
    if (!press) {
      lastCheck = performance.now();
      hover(pickAt(x, y));
    }
  };
  const onPointerUp = event => {
    const was = press;
    press = null;
    if (pointer) pointer.pressed = false;
    canvas.style.cursor = hovered ? 'pointer' : 'grab';
    wake(); // a drag glides on after you let go
    if (!was || was.id !== event.pointerId || was.moved) return;
    const { x, y } = local(event);
    const code = pickAt(x, y);
    if (code) onPick(code);
  };
  const onPointerCancel = () => {
    wake();
    press = null; // the browser took the finger over to scroll the page
    if (pointer) pointer.pressed = false;
  };
  const onPointerLeave = event => {
    if (event.pointerType === 'mouse' && !press) {
      pointer = null;
      hover(null);
    }
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);

  // ----- Moving the camera -----
  const homeFor = (w, h) => altitudeFor(w, h, w < 560 ? 0.92 : 0.88);
  let homeAltitude = homeFor(width, height);
  const stopSpinning = () => {
    controls.autoRotate = false;
  };
  controls.cursorStyle = 'grab';
  controls.enableZoom = false; // the mouse wheel keeps scrolling the page; the card has + and − buttons
  controls.enablePan = false;
  controls.dampingFactor = 0.07; // a drag glides on a little after you let go
  controls.autoRotateSpeed = SPIN_SPEED;
  controls.autoRotate = !calm;
  canvas.style.touchAction = 'pan-y'; // a sideways swipe spins the globe, an up-and-down swipe scrolls the page
  globe.pointOfView({ ...HOME, altitude: homeAltitude });

  // A flight: while it lasts, a drag can't pull the camera away and an earlier drag's glide can't push it off target.
  let landing = null;
  const fly = (place, altitude, ms, thenDo) => {
    wake(ms);
    controls.enableDamping = false;
    controls.enableRotate = false;
    globe.pointOfView({ ...place, altitude }, calm ? 0 : ms);
    clearTimeout(landing);
    landing = setTimeout(
      () => {
        controls.enableDamping = true;
        controls.enableRotate = true;
        thenDo?.();
      },
      calm ? 0 : ms + 30,
    );
  };

  // ----- The theme -----
  const setTheme = isDark => {
    const look = isDark ? LOOKS.dark : LOOKS.light;
    accent = accentColor();
    sunAt.set(...look.sunAt).normalize();
    const { uniforms } = earth;
    uniforms.sunPower.value = look.sunPower;
    uniforms.nightPower.value = look.nightPower;
    uniforms.hazePower.value = look.hazePower;
    uniforms.hazeFloor.value = look.hazeFloor;
    uniforms.cloudPower.value = look.cloudPower;
    uniforms.glintPower.value = look.glintPower;
    uniforms.reliefPower.value = look.reliefPower;
    uniforms.exposure.value = look.exposure;
    uniforms.hazeColor.value.set(look.haze);
    uniforms.shadeColor.value.setRGB(...look.shade);
    air.material.uniforms.airColor.value.set(look.air);
    air.material.uniforms.strength.value = look.airStrength;
    air.material.uniforms.nightGlow.value = look.nightGlow;
    borders.material.opacity = look.border;
    roomLight.intensity = Math.PI * look.capLight;
    sunLight.intensity = Math.PI * look.capSun;
    if (countries.length) repaint();
    wake();
  };

  // Everything is built before the first picture, so the Earth never shows half done. Then it fades in (the page does
  // that) and the countries rise out of it. They start just above the ground: any lower and the ground's own surface
  // would show through them in a pattern while they rise.
  setTheme(dark);
  await setValues(values);
  await new Promise(done => setTimeout(done, 30)); // the last country's shape is built on the next tick
  // The small programs are prepared away from the page's main work, on browsers that can do that.
  if (renderer.extensions.has('KHR_parallel_shader_compile')) await renderer.compileAsync(scene, camera).catch(() => {});
  globe.resumeAnimation();
  wake(1500);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      onReady();
      risen = true;
      globe.polygonsTransitionDuration(calm ? 0 : 900);
      repaint();
      if (!calm) setTimeout(() => globe.polygonsTransitionDuration(240), 1000);
    }),
  );

  // ----- What the page can do with it -----
  return {
    setValues,
    setTheme,
    setSelected(code) {
      if ((code || null) === selected) return;
      selected = code || null;
      repaint();
      wake();
      const place = selected ? places.get(selected) : null;
      if (place) {
        stopSpinning();
        // Big countries are seen from further away than small ones.
        const closer = 0.8 + 0.2 * Math.min(1, Math.sqrt(place.area) / 0.55);
        fly({ lat: place.lat, lng: place.lng }, homeAltitude * closer, 1300);
        // The pulse: a ring a little wider than the country, spreading out from its middle.
        const country = countries.find(item => item.code === selected);
        const { x, y, z } = globe.getCoords(place.lat, place.lng, (country ? altitudeOf(country) : 0.03) + 0.006);
        pulse.position.set(x, y, z);
        pulseRadius = Math.max(7, Math.min(36, radius * Math.sqrt(place.area / Math.PI) * 1.2));
        pulse.visible = !calm;
        pulseStart = performance.now();
        wake(PULSES * PULSE_TIME);
      } else {
        pulse.visible = false;
      }
    },
    zoom(direction) {
      wake(320);
      stopSpinning();
      const now = globe.pointOfView();
      const next = Math.min(homeAltitude * 1.5, Math.max(0.5, now.altitude * (direction > 0 ? 0.78 : 1.28)));
      globe.pointOfView({ altitude: next }, calm ? 0 : 320);
    },
    reset() {
      stopSpinning();
      fly(HOME, homeAltitude, 1100, () => {
        controls.autoRotate = !calm;
      });
    },
    resize(nextWidth, nextHeight) {
      if (!nextWidth || !nextHeight) return;
      wake();
      const now = globe.pointOfView();
      const stillHome = Math.abs(now.altitude - homeAltitude) < 0.01;
      globe.width(nextWidth).height(nextHeight);
      homeAltitude = homeFor(nextWidth, nextHeight);
      if (stillHome) globe.pointOfView({ altitude: homeAltitude });
      paintDots();
    },
    pause() {
      seen = false;
      globe.pauseAnimation();
    },
    resume() {
      if (seen) return;
      seen = true;
      resting = false; // draw again, at least for a moment: it may have been resized or changed while out of sight
      globe.resumeAnimation();
      wake();
    },
    destroy() {
      gone = true;
      scene.onBeforeRender = () => {};
      clearTimeout(landing);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      globe._destructor();
      for (const dot of dots) dot.sprite.material.dispose();
      for (const country of countries) {
        country.cap?.dispose();
        country.wall?.dispose();
      }
      for (const thing of [earth, air.material, air.geometry, borders.material, borders.geometry, pulse.material, pulsePicture, dotPicture, day, night, relief, water, clouds]) {
        thing.dispose();
      }
      renderer.forceContextLoss();
      if (window.scene === scene) delete window.scene; // three-render-objects leaves the scene on window
      container.innerHTML = '';
    },
  };
}
