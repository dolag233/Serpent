import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: '.vite/cli',
    ssr: 'src/cli/index.ts',
    rollupOptions: {
      external: ['better-sqlite3', 'koffi'],
      output: {
        format: 'es',
        entryFileNames: 'serpent.mjs',
      },
    },
  },
  ssr: { target: 'node' },
});
