import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(({ mode }) => {
  // `vite build --mode offline` (see scripts/build-offline.mjs): one script and one stylesheet,
  // nothing split or left as a separate file, so they can be inlined into a single index.html
  // that opens from a double-click (file://).
  const offline = mode === 'offline';
  return {
    base: offline ? './' : '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: offline
      ? {
          outDir: 'dist-offline',
          emptyOutDir: true,
          assetsInlineLimit: Number.MAX_SAFE_INTEGER,
          cssCodeSplit: false,
          chunkSizeWarningLimit: 4000,
          copyPublicDir: false, // the manifest and home-screen icons only work from a web server
          rolldownOptions: { output: { codeSplitting: false } },
        }
      : {
          // three.js on its own is ~535 kB minified (~133 kB gzipped); warn about anything bigger.
          chunkSizeWarningLimit: 600,
          rolldownOptions: {
            output: {
              // Libraries go in their own chunks: they change far less often than the game, so
              // browsers keep them cached across game updates.
              codeSplitting: {
                groups: [
                  // three's add-ons (examples/jsm) stay with whoever imports them, so a dynamic import
                  // (GLTFLoader in modelLoader.ts) stays its own chunk.
                  { name: 'three', test: /node_modules[\\/]three[\\/](?!examples[\\/])/ },
                  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
                ],
              },
            },
          },
        },
    server: {
      port: 3000,
      host: '0.0.0.0',
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
