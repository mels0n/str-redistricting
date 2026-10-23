import { defineConfig } from 'vite';
import { sharePages } from './build/share-pages.js';
import { versionMeta } from './build/version-meta.js';

// Static build for the map viewer. Assets and data URLs are relative, but the
// built pages carry <base href="/">, so they assume the domain root (the
// prerendered pages sit at /faq, /CO and so on). Embedding in another site
// still works through window.STR_VIEWER_CONFIG, which sets the data location.
export default defineConfig({
  base: './',
  publicDir: 'public',
  plugins: [versionMeta(), sharePages()],
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
