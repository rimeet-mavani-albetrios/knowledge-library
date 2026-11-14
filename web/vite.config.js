import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Big parts of the 3D globe's library that this app never uses: see src/components/stats/globe-unused.js.
const unused = fileURLToPath(new URL('./src/components/stats/globe-unused.js', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { 'three/webgpu': unused, 'three/tsl': unused, 'h3-js': unused } },
  build: { outDir: 'dist', emptyOutDir: true },
});
