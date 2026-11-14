// globe.gl always brings along two big parts for features this app never uses: drawing with WebGPU, and maps made of
// hexagons (the h3-js library). Together they are more than half of its weight. web/vite.config.js swaps them for this
// tiny file when the website is built, so the 3D Earth loads about twice as fast. (npm run dev uses the real ones.)
// Nothing here is ever called. If you ever want hexagon maps or WebGPU on the globe, remove the swap in vite.config.js.
export class WebGPURenderer {}
export class StorageInstancedBufferAttribute {}
export const latLngToCell = () => '';
export const cellToLatLng = () => [0, 0];
export const cellToBoundary = () => [];
export const polygonToCells = () => [];
