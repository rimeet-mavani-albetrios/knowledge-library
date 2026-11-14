// The colors of the Earth's countries, shared by the globe, its legend and the country list, so they always agree.
// Pale gold for a few links to deep orange for the most: it stands out on blue seas and on dark land alike.
// (A plain small file, so the list doesn't have to load the heavy 3D part for its colors.)

const SCALE = [
  [0, [255, 216, 104]],
  [0.35, [255, 188, 56]],
  [0.7, [255, 142, 28]],
  [1, [255, 88, 18]],
];

// t: 0 for the fewest links, 1 for the most. Gives [red, green, blue], each 0 to 255.
export function scaleColor(t) {
  const at = SCALE.findIndex(([stop]) => t <= stop);
  if (at <= 0) return SCALE[0][1];
  const [from, a] = SCALE[at - 1];
  const [to, b] = SCALE[at];
  const k = (t - from) / (to - from);
  return a.map((value, i) => Math.round(value + (b[i] - value) * k));
}

// How far along the scale a number is, in steps of "times as many" (1, 3, 10, 30…): one big country would make all
// the others pale otherwise.
export const scaleOf = (count, most) => (most > 1 ? Math.max(0, Math.log(count) / Math.log(most)) : 1);

export const cssColor = ([r, g, b], alpha = 1) => `rgba(${r},${g},${b},${alpha})`;

// The whole scale as a CSS gradient, for the legend.
export const SCALE_GRADIENT = `linear-gradient(90deg, ${SCALE.map(([stop, color]) => `${cssColor(color)} ${stop * 100}%`).join(', ')})`;
