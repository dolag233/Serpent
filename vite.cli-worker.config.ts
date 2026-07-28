import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: '.vite/cli-worker',
    ssr: 'src/cli/worker.ts',
    rollupOptions: {
      external: ['better-sqlite3', 'sharp', 'trash', 'exifr', 'koffi'],
      output: {
        format: 'es',
        entryFileNames: 'cli-worker.mjs',
      },
    },
  },
  ssr: { target: 'node' },
});
