import { defineConfig } from 'vite';

// Static build for the map viewer. A relative base keeps every asset and data
// URL relative to the page, so the build works at a domain root, in a
// subdirectory, or embedded in another site.
export default defineConfig({
  base: './',
  publicDir: 'public',
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
