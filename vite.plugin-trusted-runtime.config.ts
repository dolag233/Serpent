import { defineConfig } from 'vite';

/**
 * Per-plugin Trusted Host UtilityProcess. Full Node is intentional: this entry
 * must never be loaded into Main or Renderer.
 */
export default defineConfig({
  build: {
    ssr: 'src/scripting/plugin-trusted-host-entry.ts',
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'plugin_trusted_host.js',
      },
    },
  },
});
