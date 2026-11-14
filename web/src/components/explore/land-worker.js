// The painter in the background: paints the Explore map's land on its own thread and hands back finished pictures.
// Painting all the land can take a long time when you're zoomed in, and on the page itself that would freeze everything.
// Here the map keeps moving, and the picture simply arrives a moment later.
import { makeGlow, newCanvas, paintLand, readLand } from './land-paint.js';

let land = null;
let colors = null;
let aspect = 0.6;
let glow = null;

self.onmessage = ({ data }) => {
  if (data.type === 'land') {
    land = data.land ? readLand(data.land) : null;
    aspect = data.aspect;
    glow = null;
  } else if (data.type === 'colors') {
    colors = data.colors;
    glow = null;
  } else if (data.type === 'paint') {
    const { id, width, height } = data;
    if (!land || !colors) {
      self.postMessage({ id, picture: null });
      return;
    }
    glow ??= makeGlow(land, colors, aspect);
    const canvas = newCanvas(width, height);
    // (`willReadFrequently` paints on this thread. Otherwise the graphics card does the work, and the dots have to wait.)
    paintLand(canvas.getContext('2d', { willReadFrequently: true }), land, colors, glow, data);
    const picture = canvas.transferToImageBitmap();
    self.postMessage({ id, picture }, [picture]);
  }
};
