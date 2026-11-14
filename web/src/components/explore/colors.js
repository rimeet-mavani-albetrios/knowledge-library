// The colors the Explore map paints with, read from the page's own CSS, so the canvas always matches the theme
// (light or dark) and the category colors everywhere else.
//
// A canvas can't use CSS variables, so the colors are looked up once (and again when the theme changes):
// - the page colors (--surface, --text…) and the map's own (--atlas-sea, --atlas-land…: see knowledge-map.css) from the
//   Explore page itself;
// - each category's color from a hidden "probe" element that has the category's style={hueOf(name)}, exactly like
//   a card or chip, so a different color for dark mode shows up here too.
// Every color is turned into plain [red, green, blue, alpha] numbers by painting it on a 1-pixel canvas and reading the
// pixel back. That works for any color the browser understands (#hex, rgb(), oklch(), color-mix()…).

let pixel = null;
function toRgba(color, fallback = [128, 128, 128, 1]) {
  if (!color) return fallback;
  pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = rgba(fallback); // kept if the color isn't one the canvas understands
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = pixel.getImageData(0, 0, 1, 1).data;
  // A see-through color comes back already blended with nothing: undo that, to get the color itself.
  if (a > 0 && a < 255) return [Math.round((r * 255) / a), Math.round((g * 255) / a), Math.round((b * 255) / a), a / 255];
  return [r, g, b, a / 255];
}

// Part of one color, part of another (like CSS color-mix): share 0.58 means 58% of `a`.
export const mix = (a, b, share) => [0, 1, 2].map(i => Math.round(a[i] * share + b[i] * (1 - share)));

export const rgba = ([r, g, b, a = 1], alpha = a) => `rgba(${r},${g},${b},${alpha})`;

// How much of a category's color goes into its land.
const TINT = { light: 0.32, dark: 0.36 };

// root: the Explore page element. probes: { [category]: element with style={hueOf(category)} }.
export function readColors(root, probes) {
  const style = getComputedStyle(root);
  const read = (name, fallback) => toRgba(style.getPropertyValue(name).trim(), fallback);
  const dark = document.documentElement.dataset.theme === 'dark';
  const colors = {
    dark,
    surface: read('--surface', [255, 255, 255, 1]),
    bg: read('--bg', [246, 247, 251, 1]),
    text: read('--text', [20, 24, 43, 1]),
    text2: read('--text-2', [68, 75, 98, 1]),
    muted: read('--muted', [107, 114, 135, 1]),
    line: read('--line', [227, 230, 238, 1]),
    accent: read('--accent', [75, 63, 240, 1]),
    sea: read('--atlas-sea', dark ? [14, 20, 31, 1] : [223, 232, 243, 1]),
    shore: read('--atlas-shore', dark ? [31, 47, 74, 1] : [240, 246, 251, 1]),
    grid: read('--atlas-grid', dark ? [140, 170, 220, 0.07] : [60, 80, 120, 0.1]),
    land: read('--atlas-land', dark ? [28, 34, 48, 1] : [251, 248, 241, 1]),
    coast: read('--atlas-coast', dark ? [86, 104, 138, 1] : [125, 137, 160, 1]),
    border: read('--atlas-border', dark ? [10, 14, 22, 0.8] : [255, 255, 255, 0.9]),
    contour: read('--atlas-contour', dark ? [255, 255, 255, 0.07] : [40, 50, 80, 0.1]),
    halo: read('--atlas-halo', dark ? [16, 21, 31, 1] : [255, 255, 255, 1]),
    ring: read('--atlas-ring', dark ? [12, 16, 24, 1] : [255, 255, 255, 1]),
    plate: read('--atlas-plate', [255, 255, 255, 1]),
    fontBody: style.getPropertyValue('--font').trim() || 'system-ui, sans-serif',
    fontDisplay: style.getPropertyValue('--display').trim() || 'system-ui, sans-serif',
    hue: new Map(), // the category's own color: dots, rings, lines
    ink: new Map(), // words in the category's color, dark (or light) enough to read on its land
    tint: new Map(), // its land
  };
  const tint = dark ? TINT.dark : TINT.light;
  for (const [category, probe] of Object.entries(probes)) {
    if (!probe) continue;
    const hue = toRgba(getComputedStyle(probe).getPropertyValue('--hue').trim());
    colors.hue.set(category, hue);
    colors.ink.set(category, mix(hue, colors.text, dark ? 0.5 : 0.42));
    colors.tint.set(category, mix(hue, colors.land, tint));
  }
  return colors;
}
