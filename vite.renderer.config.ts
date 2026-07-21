import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Pin the renderer dev server to SERPENT_VITE_PORT (set by scripts/dev-start.mjs)
 * with strictPort so Vite never silently moves to 5174+ while Main still loads
 * a stale MAIN_WINDOW_VITE_DEV_SERVER_URL (black screen / Forge#3198).
 */
const port = Number(process.env.SERPENT_VITE_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    host: '127.0.0.1',
    port: Number.isFinite(port) && port > 0 ? port : 5173,
    strictPort: true,
  },
});
