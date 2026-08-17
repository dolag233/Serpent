/**
 * Offscreen thumbnail renderer smoke test (slice E, Serpent-hnmg).
 *
 * Platform measurement item (research §4.8-3/5): verifies that an offscreen
 * BrowserWindow on THIS machine can create a WebGL context, render one frame
 * of a trivial three.js scene, produce a non-empty `paint` event, and read
 * the frame back as a PNG — without ever showing a window.
 *
 * Usage:  npx electron scripts/offscreen-smoke.mjs
 * Exit:   0 = all assertions passed (JSON report on stdout)
 *         1 = any assertion failed or timed out (diagnostics on stderr)
 *
 * This is a standalone Electron main — it does not import Serpent app code
 * and does not touch userData.
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE = 512;
const TIMEOUT_MS = 30_000;

const report = {
  window: { width: EDGE, height: EDGE },
  page: null,
  paint: null,
  dataUrl: null,
};

const failures = [];

function check(condition, label, detail) {
  if (condition) return;
  failures.push({ label, detail });
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: EDGE,
    height: EDGE,
    show: false,
    frame: false,
    backgroundColor: '#1a1c1f',
    webPreferences: {
      offscreen: true,
      // Throwaway script only: the page needs require('three') to draw the
      // test scene. The production window is sandboxed with a dedicated
      // preload (src/main/offscreen-thumbnail-renderer.ts).
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: true,
      backgroundThrottling: false,
    },
  });

  win.webContents.on('paint', (_event, dirtyRect, image) => {
    if (report.paint) return;
    const size = image.getSize();
    report.paint = {
      dirtyRect: { x: dirtyRect.x, y: dirtyRect.y, width: dirtyRect.width, height: dirtyRect.height },
      image: { width: size.width, height: size.height },
      pngBytes: image.toPNG().length,
    };
  });

  // The page script runs synchronously during load; the ipc listener must be
  // attached before loadFile so the render signal cannot be missed.
  const pageResultPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`page render timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
    win.webContents.on('ipc-message', (_event, channel, args) => {
      if (channel !== 'smoke:rendered') return;
      clearTimeout(timer);
      resolve(args);
    });
  });

  try {
    win.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.error(`[smoke page] ${message}`);
    });
    await win.loadFile(path.join(__dirname, 'offscreen-smoke-page.html'));

    const pageResult = await pageResultPromise;
    report.page = pageResult;

    // Independent readback of the exact canvas drawing buffer (the primary
    // capture path used in production: preserveDrawingBuffer + toDataURL).
    const dataUrl = await win.webContents.executeJavaScript(
      'document.querySelector("canvas").toDataURL("image/png")',
    );
    report.dataUrl = {
      prefix: dataUrl.slice(0, 22),
      length: dataUrl.length,
    };

    // Give the compositor a beat to emit the paint for the committed frame.
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    check(
      pageResult?.status === 'ok',
      'page rendered one frame',
      { pageResult: report.page },
    );
    check(
      report.dataUrl?.prefix === 'data:image/png;base64,',
      'canvas toDataURL produced a PNG data URL',
      { dataUrl: report.dataUrl },
    );
    check(
      (report.dataUrl?.length ?? 0) > 1_000,
      'frame PNG is not empty',
      { dataUrlLength: report.dataUrl?.length },
    );
    check(
      pageResult?.corner && Array.isArray(pageResult.corner) && pageResult.corner.length === 4,
      'page reported a corner pixel',
      { corner: pageResult?.corner },
    );
    check(
      report.paint !== null,
      'paint event fired for the offscreen window',
      { paint: report.paint },
    );
    if (report.paint) {
      check(
        report.paint.image.width >= EDGE && report.paint.image.height >= EDGE,
        'paint frame size >= requested 512x512 (DPR-scaled at minimum)',
        { paint: report.paint.image },
      );
      check(
        report.paint.pngBytes > 0,
        'paint frame PNG bytes are non-empty',
        { pngBytes: report.paint.pngBytes },
      );
    }

    if (failures.length > 0) {
      console.error(JSON.stringify({ ok: false, report, failures }, null, 2));
      app.exit(1);
      return;
    }
    console.log(JSON.stringify({ ok: true, report }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ ok: false, report, failures, error: String(error) }, null, 2));
    app.exit(1);
  }
}).catch((error) => {
  console.error(`SMOKE BOOTSTRAP FAILED: ${String(error)}`);
  app.exit(1);
});
