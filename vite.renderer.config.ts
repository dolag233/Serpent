import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Pin the renderer dev server to SERPENT_VITE_PORT (set by scripts/dev-start.mjs)
 * with strictPort so Vite never silently moves to 5174+ while Main still loads
 * a stale MAIN_WINDOW_VITE_DEV_SERVER_URL (black screen / Forge#3198).
 * Host must stay `localhost` to match Forge's injected dev-server URL and the
 * renderer CSP connect-src allowlist for Vite 8's WebSocket module runner.
 */
const port = Number(process.env.SERPENT_VITE_PORT || 5173);

const rendererDir = path.dirname(fileURLToPath(import.meta.url));
const harmonyWindowsCss = path.resolve(
  rendererDir,
  "src/renderer/harmonyos-sans-sc-windows.css",
);
const harmonyStubCss = path.resolve(
  rendererDir,
  "src/renderer/harmonyos-sans-sc-stub.css",
);

/**
 * HarmonyOS Sans SC ships discrete static faces (400/500/600/700). Serpent UI
 * uses variable-font intermediate weights (520–650). Without ranged
 * @font-face descriptors, 590 titles can optically land on Medium and look
 * thinner than Noto Variable. Expand each face into a weight band so:
 *   Regular  → body / light chrome
 *   Medium   → ~500–529
 *   Semibold → ~530–569 (buttons / field labels)
 *   Bold     → ~570–799 (section headings / chrome emphasis)
 *   Black    → ≥800 (dialog / empty-state titles via CSS remap to 900)
 *
 * Also nudge vertical metrics slightly down vs Segoe/YaHei optical center.
 */
const HARMONYOS_ASCENT_OVERRIDE = "86%";
const HARMONYOS_DESCENT_OVERRIDE = "26%";
const HARMONYOS_LINE_GAP_OVERRIDE = "0%";

const HARMONYOS_WEIGHT_RANGES: Readonly<Record<string, string>> = {
  "100": "1 249",
  "300": "250 399",
  "400": "1 449",
  "500": "450 529",
  "600": "530 569",
  "700": "570 799",
  "900": "800 1000",
};

function harmonyosFontFacePatchPlugin(): Plugin {
  return {
    name: "harmonyos-font-face-patch",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (
        !normalized.includes("/harmonyos-sans-sc-webfont-splitted/") ||
        !normalized.endsWith(".css")
      ) {
        return null;
      }
      if (code.includes("ascent-override:")) {
        return null;
      }

      let next = code.replaceAll(
        /font-weight:\s*(\d+)\s*;/gu,
        (match, weight: string) => {
          const ranged = HARMONYOS_WEIGHT_RANGES[weight];
          return ranged ? `font-weight: ${ranged};` : match;
        },
      );

      next = next.replaceAll(
        /font-display:\s*swap;/gu,
        [
          "font-display: swap;",
          `ascent-override: ${HARMONYOS_ASCENT_OVERRIDE};`,
          `descent-override: ${HARMONYOS_DESCENT_OVERRIDE};`,
          `line-gap-override: ${HARMONYOS_LINE_GAP_OVERRIDE};`,
        ].join("\n"),
      );

      return { code: next, map: null };
    },
  };
}

/**
 * Vite 8 dev client uses blob: SharedWorkers and WebSocket module runner; the
 * production CSP meta in index.html blocks those under Electron. Strip the meta
 * during `vite serve` only — packaged / `vite build` output keeps strict CSP.
 */
function devRelaxCspPlugin(): Plugin {
  return {
    name: "serpent-dev-relax-csp",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replace(
          /<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/iu,
          "",
        );
      },
    },
  };
}

/** Windows-only webfont: on macOS/Linux serve an empty module (no package resolve). */
function harmonyosWindowsOnlyPlugin(): Plugin {
  return {
    name: "harmonyos-windows-only",
    enforce: "pre",
    resolveId(source, importer) {
      if (process.platform === "win32") return null;
      if (
        source === "./harmonyos-sans-sc-windows.css" ||
        source.endsWith("/harmonyos-sans-sc-windows.css") ||
        source === harmonyWindowsCss
      ) {
        return harmonyStubCss;
      }
      // Also catch absolute resolves from importer
      if (
        importer &&
        source.includes("harmonyos-sans-sc-windows.css")
      ) {
        return harmonyStubCss;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    devRelaxCspPlugin(),
    react(),
    harmonyosWindowsOnlyPlugin(),
    harmonyosFontFacePatchPlugin(),
  ],
  // Bundled HDRI environment maps (src/renderer/assets/hdri/*.hdr, ~1.5 MB
  // each) are consumed by src/renderer/3d-viewer via import.meta.glob with
  // `as: 'url'`. Without this entry Vite 8/rolldown treats .hdr as a module
  // to parse and the build fails; with it, files flow through the asset
  // pipeline and are emitted (or inlined) like any other static asset.
  assetsInclude: ['**/*.hdr'],
  build: {
    rollupOptions: {
      // Multi-page renderer build (slice E, Serpent-hnmg): the main window
      // app plus the minimal offscreen thumbnail page. Both html files land
      // in `.vite/renderer/main_window/`; Main loads the offscreen page by
      // name in dev (Vite multi-page serve) and packaged (loadFile).
      input: {
        main_window: path.resolve(rendererDir, 'index.html'),
        offscreen_thumbnail: path.resolve(rendererDir, 'offscreen-thumbnail.html'),
      },
    },
  },
  resolve: {
    preserveSymlinks: true,
  },
  server: {
    // Must match @electron-forge/plugin-vite, which hardcodes
    // MAIN_WINDOW_VITE_DEV_SERVER_URL as http://localhost:<port>. Binding only
    // 127.0.0.1 breaks Vite 8's WebSocket module runner under the renderer CSP
    // (connect-src allows ws://localhost:* but not ws://127.0.0.1:*).
    host: "localhost",
    port: Number.isFinite(port) && port > 0 ? port : 5173,
    strictPort: true,
    hmr: {
      host: "localhost",
    },
  },
});
