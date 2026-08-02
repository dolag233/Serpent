import { defineConfig } from 'vite';

/**
 * Long-lived Standard Plugin Host UtilityProcess entry. CJS like the Library
 * Worker and Script Runtime so `utilityProcess.fork` loads it in both
 * development and packaged Forge layouts.
 */
export default defineConfig({
  build: {
    ssr: 'src/scripting/plugin-standard-host-entry.ts',
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'plugin_standard_host.js',
      },
    },
  },
});
