import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/worker/index.ts',
      formats: ['cjs'],
      fileName: () => 'library_worker.js',
    },
    rollupOptions: {
      external: ['better-sqlite3', 'koffi', 'sharp', 'trash', 'exifr', '@napi-rs/canvas'],
    },
  },
});
