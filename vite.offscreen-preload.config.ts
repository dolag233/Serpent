import { defineConfig } from 'vite';

/**
 * Offscreen thumbnail preload (slice E, Serpent-hnmg): a second preload entry
 * next to the main window preload. Forge's Vite plugin merges this with its
 * preload template (`rollupOptions.input` wins over `lib.entry`), so the
 * bundle is emitted as `.vite/build/offscreen.js` — the name Main resolves as
 * `path.join(__dirname, 'offscreen.js')`.
 */
export default defineConfig({
  build: {
    lib: {
      entry: 'src/preload/offscreen.ts',
      formats: ['cjs'],
      fileName: () => 'offscreen.js',
    },
  },
});
