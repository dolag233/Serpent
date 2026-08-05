import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createOffscreenThumbnailRenderer,
  isValidPngBytes,
  offscreenWindowOptions,
  packagedRendererOutDir,
  resolveOffscreenPageUrl,
  type OffscreenRendererLogger,
  type OffscreenThumbnailRendererDeps,
  type OffscreenWebContentsLike,
  type OffscreenWindowLike,
  type PaintImageLike,
} from '../../src/main/offscreen-thumbnail-renderer';
import type { ModelThumbnailRenderRequest } from '../../src/shared/model-thumbnail-protocol';

// A real 1×1 transparent PNG (valid signature + payload for capture tests).
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let windowCounter = 0;

class FakePaintImage implements PaintImageLike {
  constructor(
    private readonly size: { width: number; height: number },
    private readonly png: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
  ) {}

  getSize(): { width: number; height: number } {
    return this.size;
  }

  toPNG(): Buffer {
    return this.png;
  }

  resize(): FakePaintImage {
    return this;
  }
}

class FakeWindow implements OffscreenWindowLike {
  readonly id = ++windowCounter;
  readonly webContents: FakeWebContents;
  readonly loadFile = vi.fn(async () => {});
  readonly loadURL = vi.fn(async () => {});
  readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });
  private destroyed = false;

  constructor() {
    this.webContents = new FakeWebContents();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

type PaintListener = (event: unknown, dirtyRect: unknown, image: PaintImageLike) => void;

class FakeWebContents implements OffscreenWebContentsLike {
  readonly sent: Array<{ channel: string; payload: unknown }> = [];
  private readonly paintListeners = new Set<PaintListener>();
  private readonly goneListeners = new Set<() => void>();
  destroyed = false;

  send(channel: string, payload: unknown): void {
    this.sent.push({ channel, payload });
  }

  on(event: 'paint', listener: PaintListener): void;
  on(event: 'render-process-gone', listener: () => void): void;
  on(event: 'paint' | 'render-process-gone', listener: PaintListener | (() => void)): void {
    if (event === 'paint') this.paintListeners.add(listener as PaintListener);
    else this.goneListeners.add(listener as () => void);
  }

  removeListener(event: 'paint', listener: PaintListener): void {
    this.paintListeners.delete(listener);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  emitPaint(image: PaintImageLike): void {
    for (const listener of this.paintListeners) {
      listener({}, { x: 0, y: 0, width: 512, height: 512 }, image);
    }
  }

  emitGone(): void {
    for (const listener of this.goneListeners) listener();
  }
}

interface Harness {
  deps: OffscreenThumbnailRendererDeps;
  windows: FakeWindow[];
  frameListeners: Set<(payload: unknown) => void>;
  logger: OffscreenRendererLogger;
  emitFrame(payload: unknown): void;
}

function makeHarness(overrides: Partial<OffscreenThumbnailRendererDeps> = {}): Harness {
  const windows: FakeWindow[] = [];
  const frameListeners = new Set<(payload: unknown) => void>();
  const logger: OffscreenRendererLogger = {
    error: vi.fn(),
    info: vi.fn(),
  };
  const deps: OffscreenThumbnailRendererDeps = {
    createWindow: vi.fn(() => {
      const window = new FakeWindow();
      windows.push(window);
      return window;
    }),
    onFrameMessage: (listener) => {
      frameListeners.add(listener);
      return () => frameListeners.delete(listener);
    },
    logger,
    pageUrl: 'offscreen-thumbnail.html',
    preloadPath: 'offscreen.js',
    timeoutMs: 200,
    ...overrides,
  };
  return {
    deps,
    windows,
    frameListeners,
    logger,
    emitFrame: (payload) => {
      for (const listener of [...frameListeners]) listener(payload);
    },
  };
}

function makeJob(overrides: Partial<ModelThumbnailRenderRequest> = {}): ModelThumbnailRenderRequest {
  return {
    type: 'model-thumbnail.render-request',
    requestId: 'job-1',
    libraryId: 'lib-1',
    assetId: 'asset-1',
    revisionId: 'rev-1',
    format: 'glb',
    renderUrl: 'serpent://preview/lib-1/art-1',
    companionMap: [],
    hdriPresetId: 'studio-small-09',
    width: 512,
    height: 512,
    timeoutMs: 200,
    ...overrides,
  };
}

function pngFromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = Buffer.from(base64, 'base64');
  const copy = new Uint8Array(binary.byteLength);
  copy.set(binary);
  return copy;
}

describe('offscreen thumbnail renderer (slice E, main side)', () => {
  it('renders a job to an ok result from the page frame message', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const resultPromise = renderer.renderModelThumbnail(makeJob());
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));
    const window = harness.windows[0]!;
    await vi.waitFor(() => expect(window.loadFile).toHaveBeenCalled());
    await vi.waitFor(() => expect(window.webContents.sent).toHaveLength(1));

    const sent = window.webContents.sent[0]!;
    expect(sent.channel).toBe('serpent:offscreen-thumbnail:render');
    expect((sent.payload as ModelThumbnailRenderRequest).requestId).toBe('job-1');

    harness.emitFrame({
      requestId: 'job-1',
      status: 'ok',
      pngBase64: TINY_PNG_BASE64,
      width: 512,
      height: 512,
    });

    const result = await resultPromise;
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(isValidPngBytes(result.pngBytes)).toBe(true);
      expect(result.width).toBe(512);
    }
    renderer.dispose();
  });

  it('runs jobs strictly serially on one shared window', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const first = renderer.renderModelThumbnail(makeJob({ requestId: 'job-1' }));
    const second = renderer.renderModelThumbnail(makeJob({ requestId: 'job-2' }));
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));
    const window = harness.windows[0]!;
    await vi.waitFor(() => expect(window.webContents.sent).toHaveLength(1));

    // Second job must not be dispatched while the first is unresolved.
    expect(window.webContents.sent.map((entry) => (entry.payload as ModelThumbnailRenderRequest).requestId))
      .toEqual(['job-1']);

    harness.emitFrame({ requestId: 'job-1', status: 'ok', pngBase64: TINY_PNG_BASE64 });
    expect((await first).status).toBe('ok');

    await vi.waitFor(() => expect(window.webContents.sent).toHaveLength(2));
    expect((window.webContents.sent[1]!.payload as ModelThumbnailRenderRequest).requestId).toBe('job-2');
    harness.emitFrame({ requestId: 'job-2', status: 'ok', pngBase64: TINY_PNG_BASE64 });
    expect((await second).status).toBe('ok');
    renderer.dispose();
  });

  it('times out with MODEL_RENDER_TIMEOUT when no frame arrives', async () => {
    const harness = makeHarness({ timeoutMs: 50 });
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const result = await renderer.renderModelThumbnail(makeJob({ timeoutMs: 50 }));
    expect(result).toMatchObject({ status: 'failed', errorCode: 'MODEL_RENDER_TIMEOUT' });
    renderer.dispose();
  });

  it('rescues an invalid frame with the composited paint image', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const resultPromise = renderer.renderModelThumbnail(makeJob());
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));
    const window = harness.windows[0]!;
    await vi.waitFor(() => expect(window.webContents.sent).toHaveLength(1));

    window.webContents.emitPaint(new FakePaintImage({ width: 512, height: 512 }));
    harness.emitFrame({ requestId: 'job-1', status: 'ok', pngBase64: 'bm90LXBuZw==' });

    const result = await resultPromise;
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.pngBytes[0]).toBe(0x89); // paint PNG bytes
    }
    renderer.dispose();
  });

  it('rescues a blank frame from the paint image', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const resultPromise = renderer.renderModelThumbnail(makeJob());
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));
    const window = harness.windows[0]!;
    await vi.waitFor(() => expect(window.webContents.sent).toHaveLength(1));

    window.webContents.emitPaint(new FakePaintImage({ width: 512, height: 512 }));
    harness.emitFrame({ requestId: 'job-1', status: 'failed', errorCode: 'MODEL_BLANK_FRAME' });

    const result = await resultPromise;
    expect(result.status).toBe('ok');
    renderer.dispose();
  });

  it('fails a job when the page reports a typed failure', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const resultPromise = renderer.renderModelThumbnail(makeJob());
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));
    await vi.waitFor(() => expect(harness.windows[0]!.webContents.sent).toHaveLength(1));

    harness.emitFrame({ requestId: 'job-1', status: 'failed', errorCode: 'MODEL_CONTEXT_LOST' });
    const result = await resultPromise;
    expect(result).toMatchObject({ status: 'failed', errorCode: 'MODEL_CONTEXT_LOST' });
    renderer.dispose();
  });

  it('fails with MODEL_WINDOW_FAILED when the page cannot load', async () => {
    let windowCount = 0;
    const harness = makeHarness({
      createWindow: vi.fn(() => {
        windowCount += 1;
        const window = new FakeWindow();
        harness.windows.push(window);
        // First window's load fails; the retried window loads cleanly.
        if (windowCount === 1) {
          window.loadFile.mockRejectedValueOnce(new Error('load exploded'));
        }
        return window;
      }),
    });
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const result = await renderer.renderModelThumbnail(makeJob());
    expect(result).toMatchObject({ status: 'failed', errorCode: 'MODEL_WINDOW_FAILED' });
    // A failed load destroys the window; a later job recreates it.
    expect(harness.windows[0]!.destroy).toHaveBeenCalled();

    const secondResultPromise = renderer.renderModelThumbnail(makeJob({ requestId: 'job-2' }));
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2));
    const replacement = harness.windows[1]!;
    await vi.waitFor(() => expect(replacement.webContents.sent).toHaveLength(1));
    harness.emitFrame({ requestId: 'job-2', status: 'ok', pngBase64: TINY_PNG_BASE64 });
    expect((await secondResultPromise).status).toBe('ok');
    renderer.dispose();
  });

  it('recreates the window after a renderer crash', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const first = renderer.renderModelThumbnail(makeJob({ requestId: 'job-1' }));
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));
    const window = harness.windows[0]!;
    await vi.waitFor(() => expect(window.webContents.sent).toHaveLength(1));

    window.webContents.emitGone();
    expect((await first)).toMatchObject({ status: 'failed', errorCode: 'MODEL_WINDOW_FAILED' });

    const second = renderer.renderModelThumbnail(makeJob({ requestId: 'job-2' }));
    await vi.waitFor(() => expect(harness.windows).toHaveLength(2));
    const replacement = harness.windows[1]!;
    await vi.waitFor(() => expect(replacement.webContents.sent).toHaveLength(1));
    harness.emitFrame({ requestId: 'job-2', status: 'ok', pngBase64: TINY_PNG_BASE64 });
    expect((await second).status).toBe('ok');
    renderer.dispose();
  });

  it('dispose fails queued and active jobs and destroys the window', async () => {
    const harness = makeHarness();
    const renderer = createOffscreenThumbnailRenderer(harness.deps);

    const active = renderer.renderModelThumbnail(makeJob({ requestId: 'job-1' }));
    const queued = renderer.renderModelThumbnail(makeJob({ requestId: 'job-2' }));
    await vi.waitFor(() => expect(harness.windows).toHaveLength(1));

    renderer.dispose();

    expect((await active)).toMatchObject({ status: 'failed', errorCode: 'MODEL_RENDER_ABORTED' });
    expect((await queued)).toMatchObject({ status: 'failed', errorCode: 'MODEL_RENDER_ABORTED' });
    expect(harness.windows[0]!.destroy).toHaveBeenCalled();
    // New jobs after dispose fail fast.
    expect((await renderer.renderModelThumbnail(makeJob())))
      .toMatchObject({ status: 'failed', errorCode: 'MODEL_RENDER_ABORTED' });
  });

  it('resolves page URLs for dev server and packaged builds', () => {
    expect(resolveOffscreenPageUrl({ devServerUrl: 'http://localhost:5173', rendererOutDir: 'R' }))
      .toBe('http://localhost:5173/offscreen-thumbnail.html');
    // path.join is platform-native (backslashes on Windows).
    expect(resolveOffscreenPageUrl({ devServerUrl: null, rendererOutDir: 'R' }))
      .toBe(path.join('R', 'offscreen-thumbnail.html'));
    expect(packagedRendererOutDir()).toContain(path.join('renderer', 'main_window'));
  });

  it('builds sandboxed offscreen window options with the dedicated preload', () => {
    const options = offscreenWindowOptions({ preloadPath: 'offscreen.js', width: 512, height: 512 });
    expect(options.show).toBe(false);
    expect(options.webPreferences).toMatchObject({
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: 'offscreen.js',
    });
  });

  it('validates PNG signatures', () => {
    expect(isValidPngBytes(pngFromBase64(TINY_PNG_BASE64))).toBe(true);
    expect(isValidPngBytes(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isValidPngBytes(new Uint8Array())).toBe(false);
  });
});
