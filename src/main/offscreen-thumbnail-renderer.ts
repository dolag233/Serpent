/**
 * Offscreen model-thumbnail renderer (slice E, Serpent-hnmg).
 *
 * Main owns the ONE shared offscreen BrowserWindow every model thumbnail is
 * rendered in (research §4.5/§4.7: Chromium caps live WebGL contexts at ~16,
 * so per-asset windows are not an option; the window is created lazily on the
 * first model job and reused). Jobs run strictly serially — one frame at a
 * time — with a per-job deadline; the page renders exactly one frame per job
 * (no rAF dependency, research §4.7 `backgroundThrottling` does not help
 * hidden windows).
 *
 * Frame capture: the page reads its WebGL drawing buffer directly
 * (`preserveDrawingBuffer` + `toDataURL`, deterministic and DPR-free because
 * the page forces pixelRatio 1). The window's `paint` event is recorded as a
 * fallback source — `capturePage` on hidden windows is known-broken
 * (research §4.5), but `paint` is the composited truth and rescues the job
 * when the direct readback returns invalid/blank bytes (driver quirks on
 * some platforms). The paint image is only trusted for the CURRENT job
 * (listeners are per-window; the queue is serial so there is exactly one
 * active job at a time).
 *
 * Failure policy: every failure resolves as a typed
 * `ModelThumbnailRenderResult` — never a throw across the queue boundary —
 * so the Worker can store a failed artifact and the card keeps the generic
 * 3D icon (spec 3D-16).
 *
 * This module has NO runtime electron imports (types only) so the queue,
 * timeout and capture logic are unit-testable in vitest with structural
 * fakes; `src/main/index.ts` supplies the real window/ipc wiring.
 */

import path from 'node:path';

import type { BrowserWindowConstructorOptions } from 'electron';

import {
  MODEL_THUMBNAIL_DEFAULT_EDGE,
  MODEL_THUMBNAIL_RENDER_TIMEOUT_MS,
  type ModelThumbnailErrorCode,
  type ModelThumbnailRenderRequest,
  type ModelThumbnailRenderResult,
} from '../shared/model-thumbnail-protocol';
import { OFFSCREEN_THUMBNAIL_RENDER_CHANNEL } from '../shared/protocol/channels';

/** Structural window surface (BrowserWindow in production, fakes in tests). */
export interface OffscreenWindowLike {
  readonly id: number;
  readonly webContents: OffscreenWebContentsLike;
  destroy(): void;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  loadFile(filePath: string): Promise<void>;
}

/** Structural webContents surface (paint capture + renderer-gone are the events we use). */
export interface OffscreenWebContentsLike {
  send(channel: string, payload: unknown): void;
  on(
    event: 'paint',
    listener: (event: unknown, dirtyRect: unknown, image: PaintImageLike) => void,
  ): void;
  removeListener(
    event: 'paint',
    listener: (event: unknown, dirtyRect: unknown, image: PaintImageLike) => void,
  ): void;
  /** Renderer crash/GPU-process teardown hook (webContents 'render-process-gone'). */
  on(event: 'render-process-gone', listener: () => void): void;
  isDestroyed(): boolean;
}

/** Structural NativeImage surface (toPNG/resize only). */
export interface PaintImageLike {
  getSize(): { width: number; height: number };
  toPNG(): Buffer;
  resize(options: { width?: number; height?: number; quality?: string }): PaintImageLike;
}

export interface OffscreenRendererLogger {
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
  info(scope: string, message: string, context?: Record<string, unknown>): void;
}

export interface OffscreenThumbnailRendererDeps {
  /** Production: `new BrowserWindow(options)`; tests inject a fake. */
  createWindow(options: BrowserWindowConstructorOptions): OffscreenWindowLike;
  /** Production: ipcMain.on(OFFSCREEN_THUMBNAIL_FRAME_CHANNEL, ...); returns unsubscribe. */
  onFrameMessage(listener: (payload: unknown) => void): () => void;
  logger: OffscreenRendererLogger;
  /** Offscreen page URL (dev server) or file path (packaged). */
  pageUrl: string;
  /** Preload bundle path (`path.join(__dirname, 'offscreen.js')`). */
  preloadPath: string;
  /** Per-job deadline; defaults to MODEL_THUMBNAIL_RENDER_TIMEOUT_MS. */
  timeoutMs?: number;
}

export interface OffscreenThumbnailRenderer {
  /** Enqueue a render; resolves with bytes or a typed failure. Never rejects. */
  renderModelThumbnail(job: ModelThumbnailRenderRequest): Promise<ModelThumbnailRenderResult>;
  /** Fail queued + active jobs and destroy the window. Idempotent. */
  dispose(): void;
}

/** Window options for the shared offscreen renderer window (pure, testable). */
export function offscreenWindowOptions(input: {
  preloadPath: string;
  width: number;
  height: number;
}): BrowserWindowConstructorOptions {
  return {
    width: input.width,
    height: input.height,
    show: false,
    frame: false,
    backgroundColor: '#1a1c1f',
    webPreferences: {
      // Official offscreen path (research §4.5): WebGL + paint events.
      offscreen: true,
      // Same sandbox/contextIsolation posture as the main window; the page
      // talks to Main only through its dedicated minimal preload.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: input.preloadPath,
      // Harmless for hidden windows but keeps the flag explicit.
      backgroundThrottling: false,
    },
  };
}

/** Offscreen page URL in dev (multi-page Vite server) vs packaged (built html). */
export function resolveOffscreenPageUrl(input: {
  devServerUrl: string | null;
  /** Packaged renderer output dir, e.g. `<app>/.vite/renderer/main_window`. */
  rendererOutDir: string;
}): string {
  if (input.devServerUrl) return `${input.devServerUrl}/offscreen-thumbnail.html`;
  return path.join(input.rendererOutDir, 'offscreen-thumbnail.html');
}

/** Resolve the packaged renderer output dir from the main bundle location. */
export function packagedRendererOutDir(): string {
  // MAIN_WINDOW_VITE_NAME is injected by Forge; outside Forge (unit tests)
  // the renderer entry name is the stable default.
  const entryName = typeof MAIN_WINDOW_VITE_NAME === 'string' ? MAIN_WINDOW_VITE_NAME : 'main_window';
  return path.join(__dirname, `../renderer/${entryName}`);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when `bytes` carries a PNG signature and a plausible payload. */
export function isValidPngBytes(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.length) return false;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

interface FrameMessage {
  readonly requestId: string;
  readonly status: 'ok' | 'failed';
  readonly pngBase64?: string;
  readonly frames?: Array<{
    view: [number, number, number];
    pngBase64: string;
    width?: number;
    height?: number;
  }>;
  readonly width?: number;
  readonly height?: number;
  readonly errorCode?: string;
}

/** Minimal structural validation of the page's frame message (own page, still validated). */
function parseFrameMessage(payload: unknown): FrameMessage | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.requestId !== 'string' || record.requestId.length === 0) return null;
  if (record.status === 'ok') {
    if (Array.isArray(record.frames)) {
      const frames = record.frames.filter(
        (frame): frame is {
          view: [number, number, number];
          pngBase64: string;
          width?: number;
          height?: number;
        } =>
          typeof frame === 'object' && frame !== null &&
          Array.isArray(frame.view) && frame.view.length === 3 &&
          frame.view.every((n: unknown) => typeof n === 'number') &&
          typeof frame.pngBase64 === 'string' && frame.pngBase64.length > 0,
      );
      if (frames.length === 0) return null;
      return {
        requestId: record.requestId,
        status: 'ok',
        frames: frames.map((frame) => ({
          view: [frame.view[0], frame.view[1], frame.view[2]] as [number, number, number],
          pngBase64: frame.pngBase64,
          width: typeof frame.width === 'number' ? frame.width : undefined,
          height: typeof frame.height === 'number' ? frame.height : undefined,
        })),
      };
    }
    if (typeof record.pngBase64 !== 'string' || record.pngBase64.length === 0) return null;
    return {
      requestId: record.requestId,
      status: 'ok',
      pngBase64: record.pngBase64,
      width: typeof record.width === 'number' ? record.width : undefined,
      height: typeof record.height === 'number' ? record.height : undefined,
    };
  }
  if (record.status === 'failed') {
    return {
      requestId: record.requestId,
      status: 'failed',
      errorCode: typeof record.errorCode === 'string' ? record.errorCode : 'MODEL_LOAD_FAILED',
    };
  }
  return null;
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = Buffer.from(base64, 'base64');
  // Copy into a fresh ArrayBuffer-backed view (Buffer's pool may be a
  // SharedArrayBuffer under some runtimes; the protocol types require
  // ArrayBuffer).
  const copy = new Uint8Array(binary.byteLength);
  copy.set(binary);
  return copy;
}

interface QueuedJob {
  readonly job: ModelThumbnailRenderRequest;
  readonly resolve: (result: ModelThumbnailRenderResult) => void;
}

interface ActiveJob extends QueuedJob {
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Latest composited paint for the active job (fallback capture source). */
  paint: PaintImageLike | null;
  settled: boolean;
}

export function createOffscreenThumbnailRenderer(
  deps: OffscreenThumbnailRendererDeps,
): OffscreenThumbnailRenderer {
  const timeoutMs = deps.timeoutMs ?? MODEL_THUMBNAIL_RENDER_TIMEOUT_MS;
  const queue: QueuedJob[] = [];
  let active: ActiveJob | null = null;
  let draining = false;
  let disposed = false;
  let window: OffscreenWindowLike | null = null;
  let windowPromise: Promise<OffscreenWindowLike> | null = null;
  let unsubscribeFrames: (() => void) | null = null;

  const settleActive = (result: ModelThumbnailRenderResult): void => {
    const current = active;
    if (!current || current.settled) return;
    current.settled = true;
    if (current.timer !== undefined) clearTimeout(current.timer);
    active = null;
    current.resolve(result);
    void drain();
  };

  // Electron's paint listener is (details, dirtyRect, image) — image is the
  // third argument.
  const onPaint = (_event: unknown, _dirtyRect: unknown, image: PaintImageLike): void => {
    if (!active) return;
    active.paint = image;
  };

  const onFrameMessage = (payload: unknown): void => {
    const current = active;
    if (!current) return;
    const message = parseFrameMessage(payload);
    if (!message || message.requestId !== current.job.requestId) return;

    if (message.status === 'failed') {
      if (message.errorCode === 'MODEL_BLANK_FRAME' && current.paint) {
        // Readback produced a blank frame but the compositor has real pixels:
        // the paint frame is the authoritative capture (driver quirk rescue).
        const size = current.paint.getSize();
        if (size.width > 0 && size.height > 0) {
          const resized = current.paint.resize({
            width: current.job.width,
            height: current.job.height,
            quality: 'best',
          });
          const bytes = resized.toPNG();
          if (bytes.byteLength > 0) {
            deps.logger.info(
              'offscreen-thumbnail.paint-rescue',
              'Blank frame readback rescued from the composited paint frame.',
              { libraryId: current.job.libraryId, assetId: current.job.assetId },
            );
            settleActive({
              status: 'ok',
              pngBytes: new Uint8Array(bytes),
              width: current.job.width,
              height: current.job.height,
            });
            return;
          }
        }
      }
      settleActive({
        status: 'failed',
        errorCode: asErrorCode(message.errorCode ?? 'MODEL_LOAD_FAILED'),
        reason: `offscreen render failed for ${current.job.libraryId}/${current.job.assetId}`,
      });
      return;
    }

    if (message.frames && message.frames.length > 0) {
      // Serpent-6w40: multi-view render — validate every frame and hand the
      // packed bytes to the worker (it tiles them into the AI sheet).
      const frames: Array<{
        view: [number, number, number];
        pngBytes: Uint8Array<ArrayBuffer>;
        width: number;
        height: number;
      }> = [];
      for (const frame of message.frames) {
        const bytes = base64ToBytes(frame.pngBase64);
        if (!isValidPngBytes(bytes)) {
          settleActive({
            status: 'failed',
            errorCode: 'MODEL_FRAME_INVALID',
            reason: 'offscreen multi-view frame is not a PNG',
          });
          return;
        }
        frames.push({
          view: frame.view,
          pngBytes: new Uint8Array(bytes) as Uint8Array<ArrayBuffer>,
          width: frame.width ?? current.job.width,
          height: frame.height ?? current.job.height,
        });
      }
      settleActive({ status: 'ok', frames });
      return;
    }

    const pngBytes = base64ToBytes(message.pngBase64!);
    if (isValidPngBytes(pngBytes)) {
      settleActive({
        status: 'ok',
        pngBytes,
        width: message.width ?? current.job.width,
        height: message.height ?? current.job.height,
      });
      return;
    }
    if (current.paint) {
      const size = current.paint.getSize();
      if (size.width > 0 && size.height > 0) {
        const resized = current.paint.resize({
          width: current.job.width,
          height: current.job.height,
          quality: 'best',
        });
        const bytes = resized.toPNG();
        if (bytes.byteLength > 0) {
          settleActive({
            status: 'ok',
            pngBytes: new Uint8Array(bytes),
            width: current.job.width,
            height: current.job.height,
          });
          return;
        }
      }
    }
    settleActive({
      status: 'failed',
      errorCode: 'MODEL_FRAME_INVALID',
      reason: 'frame bytes failed PNG validation',
    });
  };

  const onWindowGone = (reason: string): void => {
    window = null;
    settleActive({
      status: 'failed',
      errorCode: 'MODEL_WINDOW_FAILED',
      reason,
    });
  };

  const createWindow = async (): Promise<OffscreenWindowLike> => {
    const created = deps.createWindow(
      offscreenWindowOptions({
        preloadPath: deps.preloadPath,
        width: MODEL_THUMBNAIL_DEFAULT_EDGE,
        height: MODEL_THUMBNAIL_DEFAULT_EDGE,
      }),
    );
    const contents = created.webContents;
    contents.on('paint', onPaint);
    // A crashed/hung renderer must not strand the queue: fail the active job;
    // the next job recreates the window from scratch.
    const onRenderProcessGone = (): void => onWindowGone('offscreen renderer process gone');
    contents.on('render-process-gone', onRenderProcessGone);
    try {
      if (/^https?:\/\//iu.test(deps.pageUrl)) {
        await created.loadURL(deps.pageUrl);
      } else {
        await created.loadFile(deps.pageUrl);
      }
    } catch (error) {
      deps.logger.error('offscreen-thumbnail.page-load', error, { pageUrl: deps.pageUrl });
      try {
        created.destroy();
      } catch {
        // Already destroyed.
      }
      throw error;
    }
    window = created;
    deps.logger.info('offscreen-thumbnail.window-ready', 'Offscreen renderer window ready.', {
      pageUrl: deps.pageUrl,
    });
    return created;
  };

  const ensureWindow = (): Promise<OffscreenWindowLike> => {
    if (window && !window.isDestroyed()) return Promise.resolve(window);
    if (!windowPromise) {
      windowPromise = createWindow().finally(() => {
        windowPromise = null;
      });
    }
    return windowPromise;
  };

  const runJob = async (entry: QueuedJob): Promise<void> => {
    const current: ActiveJob = { ...entry, timer: undefined, paint: null, settled: false };
    active = current;
    const timer = setTimeout(() => {
      settleActive({
        status: 'failed',
        errorCode: 'MODEL_RENDER_TIMEOUT',
        reason: `no frame within ${timeoutMs}ms`,
      });
    }, timeoutMs);
    current.timer = timer;

    try {
      const target = await ensureWindow();
      if (disposed || target.webContents.isDestroyed()) {
        settleActive({
          status: 'failed',
          errorCode: 'MODEL_WINDOW_FAILED',
          reason: 'offscreen window unavailable',
        });
        return;
      }
      target.webContents.send(OFFSCREEN_THUMBNAIL_RENDER_CHANNEL, entry.job);
    } catch (error) {
      deps.logger.error('offscreen-thumbnail.dispatch', error, {
        libraryId: entry.job.libraryId,
        assetId: entry.job.assetId,
      });
      settleActive({
        status: 'failed',
        errorCode: 'MODEL_WINDOW_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const drain = async (): Promise<void> => {
    if (draining || disposed) return;
    draining = true;
    try {
      while (!disposed && active === null && queue.length > 0) {
        const entry = queue.shift()!;
        await runJob(entry);
      }
    } finally {
      draining = false;
    }
  };

  if (!unsubscribeFrames) {
    unsubscribeFrames = deps.onFrameMessage(onFrameMessage);
  }

  return {
    renderModelThumbnail(job) {
      if (disposed) {
        return Promise.resolve({
          status: 'failed',
          errorCode: 'MODEL_RENDER_ABORTED',
          reason: 'offscreen renderer disposed',
        });
      }
      return new Promise<ModelThumbnailRenderResult>((resolve) => {
        queue.push({ job, resolve });
        void drain();
      });
    },
    dispose() {
      disposed = true;
      unsubscribeFrames?.();
      unsubscribeFrames = null;
      settleActive({
        status: 'failed',
        errorCode: 'MODEL_RENDER_ABORTED',
        reason: 'offscreen renderer disposed',
      });
      for (const entry of queue.splice(0)) {
        entry.resolve({
          status: 'failed',
          errorCode: 'MODEL_RENDER_ABORTED',
          reason: 'offscreen renderer disposed',
        });
      }
      windowPromise = null;
      if (window && !window.isDestroyed()) {
        try {
          window.destroy();
        } catch {
          // Already destroyed.
        }
      }
      window = null;
    },
  };
}

function asErrorCode(code: string): ModelThumbnailErrorCode {
  // The page is ours, but keep the queue contract typed: unknown codes
  // degrade to MODEL_LOAD_FAILED instead of poisoning the artifact table.
  switch (code) {
    case 'MODEL_RENDER_TIMEOUT':
    case 'MODEL_LOAD_FAILED':
    case 'MODEL_WEBGL_UNAVAILABLE':
    case 'MODEL_CONTEXT_LOST':
    case 'MODEL_EMPTY_SCENE':
    case 'MODEL_BLANK_FRAME':
    case 'MODEL_FRAME_INVALID':
    case 'MODEL_WINDOW_FAILED':
    case 'MODEL_RENDER_ABORTED':
    case 'MODEL_TOO_LARGE':
      return code;
    default:
      return 'MODEL_LOAD_FAILED';
  }
}
