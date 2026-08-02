import { defineConfig } from 'vite';

/**
 * The isolated QuickJS executor is a separate Electron UtilityProcess entry.
 * Keep it as CJS like the Library Worker so `utilityProcess.fork` can load it
 * in both development and packaged Forge layouts.
 */
export default defineConfig({
  build: {
    // UtilityProcess is Node, not a renderer/Web Worker. SSR conditions keep
    // TypeScript and QuickJS on their Node entrypoints instead of emitting a
    // browser compatibility shim that crashes before the ready handshake.
    ssr: 'src/scripting/script-runtime-utility-entry.ts',
    rollupOptions: {
      output: {
        format: 'cjs',
        entryFileNames: 'script_runtime_utility.js',
      },
    },
  },
});
