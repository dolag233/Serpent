import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/preload/critical-confirmation.ts',
      formats: ['cjs'],
      fileName: () => 'critical-confirmation.js',
    },
  },
});
