/**
 * Offscreen thumbnail page entry (slice E, Serpent-hnmg).
 *
 * This page is loaded ONLY inside the hidden offscreen BrowserWindow owned by
 * Main (`src/main/offscreen-thumbnail-renderer.ts`). It receives one render
 * job at a time over the dedicated preload bridge, renders a single frame via
 * the shared 3d-viewer core, and posts the PNG back. It never mounts the main
 * React app, never opens windows, and exposes no path/SQL capability.
 *
 * Renderer lifecycle: ONE WebGLRenderer (created with preserveDrawingBuffer so
 * the frame survives for readback/toDataURL) is reused across jobs; scene,
 * camera and environment are created and disposed per job by
 * `renderModelThumbnailFrame`. A GPU context loss tears the renderer down and
 * reports MODEL_CONTEXT_LOST — the next job recreates it.
 */

import { WebGLRenderer } from 'three';

import type { ModelThumbnailRenderRequest } from '../../shared/model-thumbnail-protocol';
import { renderModelThumbnailFrame } from './page-renderer';

/** Bridge exposed by `src/preload/offscreen.ts`. */
interface OffscreenThumbnailBridge {
  onRender(listener: (job: ModelThumbnailRenderRequest) => void): () => void;
  sendFrame(payload: unknown): void;
}

declare global {
  interface Window {
    offscreenThumbnail?: OffscreenThumbnailBridge;
  }
}

let renderer: WebGLRenderer | null = null;
let activeJobId: string | null = null;

function ensureRenderer(): WebGLRenderer {
  if (renderer && !renderer.domElement.isConnected) {
    renderer.dispose();
    renderer = null;
  }
  if (!renderer) {
    renderer = new WebGLRenderer({
      antialias: true,
      // The frame must survive past the render call for toDataURL readback;
      // this is a per-job single frame, so the memory cost is bounded.
      preserveDrawingBuffer: true,
      alpha: false,
    });
    renderer.setPixelRatio(1);
    const canvas = renderer.domElement;
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    document.body.appendChild(canvas);
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      renderer?.dispose();
      renderer = null;
      const jobId = activeJobId;
      activeJobId = null;
      if (jobId) {
        window.offscreenThumbnail?.sendFrame({
          requestId: jobId,
          status: 'failed',
          errorCode: 'MODEL_CONTEXT_LOST',
        });
      }
    });
  }
  return renderer;
}

const bridge = window.offscreenThumbnail;
if (!bridge) {
  // Loaded outside the offscreen host (e.g. someone opens the page in a
  // regular browser tab) — fail loudly instead of pretending to render.
  throw new Error('Offscreen thumbnail page requires the offscreenThumbnail preload bridge.');
}

bridge.onRender((job) => {
  activeJobId = job.requestId;
  void renderModelThumbnailFrame(job, {
    renderer: ensureRenderer(),
    log: (message, context) => {
      console.log(message, context ?? {});
    },
  })
    .then((outcome) => {
      if (activeJobId === job.requestId) activeJobId = null;
      bridge.sendFrame({ requestId: job.requestId, ...outcome });
    })
    .catch((error: unknown) => {
      if (activeJobId === job.requestId) activeJobId = null;
      console.error('offscreen-thumbnail.render-error', error);
      bridge.sendFrame({
        requestId: job.requestId,
        status: 'failed',
        errorCode: 'MODEL_LOAD_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      });
    });
});

// Keep the page DOM minimal and dark so the composited paint (Main's
// fallback capture) matches the rendered frame.
document.documentElement.style.backgroundColor = '#1a1c1f';
document.body.style.backgroundColor = '#1a1c1f';
document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.overflow = 'hidden';
