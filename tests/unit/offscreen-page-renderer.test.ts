import { describe, expect, it, vi } from 'vitest';

import type { ModelThumbnailRenderRequest } from '../../src/shared/model-thumbnail-protocol';
import {
  detectBlankWebglFrame,
  renderModelThumbnailFrame,
  type FramePipelineDeps,
  type FrameRendererLike,
} from '../../src/renderer/offscreen-thumbnail/page-renderer';

const TINY_PNG_DATA_URL = `data:image/png;base64,${'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='}`;

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
    hdriPresetId: 'ferndale-studio-03',
    width: 512,
    height: 512,
    ...overrides,
  };
}

function makeCanvas(): HTMLCanvasElement {
  return {
    width: 512,
    height: 512,
    toDataURL: () => TINY_PNG_DATA_URL,
  } as unknown as HTMLCanvasElement;
}

function makeRenderer(): FrameRendererLike & { render: ReturnType<typeof vi.fn> } {
  return {
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(() => {}),
    domElement: makeCanvas(),
    getContext: () => null,
    toneMapping: 0,
    toneMappingExposure: 1,
  };
}

function makeDeps(overrides: Partial<FramePipelineDeps> = {}): FramePipelineDeps {
  return {
    renderer: makeRenderer(),
    loadModel: vi.fn(async () => ({
      scene: { type: 'Group' } as never,
      animations: [],
      missingTextures: [],
    })),
    loadHdrData: vi.fn(async () => ({ dispose: vi.fn() } as never)),
    pmrem: {
      fromEquirectangular: () => ({ texture: { dispose: vi.fn() } as never, dispose: vi.fn() }),
      dispose: vi.fn(),
    },
    computeBounds: () => ({ empty: false, min: [-1, -1, -1], max: [1, 1, 1] }),
    isBlank: () => false,
    capturePng: (canvas) => canvas.toDataURL('image/png'),
    ...overrides,
  };
}

describe('offscreen thumbnail frame pipeline (slice E, page side)', () => {
  it('renders one frame and returns the captured PNG', async () => {
    const deps = makeDeps();
    const outcome = await renderModelThumbnailFrame(makeJob(), deps);

    expect(outcome).toMatchObject({ status: 'ok', width: 512, height: 512 });
    if (outcome.status === 'ok' && 'pngBase64' in outcome) {
      expect(outcome.pngBase64.startsWith('iVBOR')).toBe(true);
    }
    // Exactly one frame, fixed DPR-free drawing buffer.
    expect(deps.renderer.setPixelRatio).toHaveBeenCalledWith(1);
    expect(deps.renderer.setSize).toHaveBeenCalledWith(512, 512, false);
    expect(deps.renderer.render).toHaveBeenCalledTimes(1);
    // The model loader got the source URL + companion map shape.
    expect(deps.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'glb',
        sourceUrl: 'serpent://preview/lib-1/art-1',
        libraryId: 'lib-1',
      }),
    );
  });

  it('loads the bundled HDRI through the app-assets route', async () => {
    const deps = makeDeps();
    const loadHdrData = deps.loadHdrData as ReturnType<typeof vi.fn>;
    await renderModelThumbnailFrame(makeJob(), deps);
    expect(loadHdrData).toHaveBeenCalledWith(
      'serpent://app-assets/hdri/ferndale_studio_03_1k.hdr',
    );
  });

  it('can render with the deterministic key-light fallback', async () => {
    const deps = makeDeps({ enableHdri: false });
    await renderModelThumbnailFrame(makeJob(), deps);
    expect(deps.loadHdrData).not.toHaveBeenCalled();
    expect(deps.renderer.render).toHaveBeenCalledTimes(1);
  });

  it('degrades to the key light when the environment fails to load', async () => {
    const deps = makeDeps({
      loadHdrData: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });
    const outcome = await renderModelThumbnailFrame(makeJob(), deps);
    expect(outcome.status).toBe('ok');
  });

  it('reports MODEL_LOAD_FAILED when the model cannot be parsed', async () => {
    const deps = makeDeps({
      loadModel: vi.fn(async () => {
        throw new Error('gltf parse error');
      }),
    });
    const outcome = await renderModelThumbnailFrame(makeJob(), deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MODEL_LOAD_FAILED' });
  });

  it('reports MODEL_EMPTY_SCENE when the model has no geometry', async () => {
    const deps = makeDeps({
      computeBounds: () => ({ empty: true, min: [0, 0, 0], max: [0, 0, 0] }),
    });
    const outcome = await renderModelThumbnailFrame(makeJob(), deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MODEL_EMPTY_SCENE' });
  });

  it('reports MODEL_BLANK_FRAME when every sampled pixel is identical', async () => {
    const deps = makeDeps({ isBlank: () => true });
    const outcome = await renderModelThumbnailFrame(makeJob(), deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MODEL_BLANK_FRAME' });
  });

  it('reports MODEL_FRAME_INVALID when the capture produces no PNG data URL', async () => {
    const deps = makeDeps({ capturePng: () => 'not-a-png' });
    const outcome = await renderModelThumbnailFrame(makeJob(), deps);
    expect(outcome).toMatchObject({ status: 'failed', errorCode: 'MODEL_FRAME_INVALID' });
  });

  it('rejects malformed jobs before touching the renderer', async () => {
    const deps = makeDeps();
    const outcome = await renderModelThumbnailFrame(
      { ...makeJob(), width: 3 } as ModelThumbnailRenderRequest,
      deps,
    );
    expect(outcome.status).toBe('failed');
    expect(deps.renderer.render).not.toHaveBeenCalled();
  });

  it('detects uniform frames and tolerates a missing GL context', () => {
    const canvas = makeCanvas();
    const uniformContext = {
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels: vi.fn((_x, _y, _w, _h, _fmt, _type, pixel: Uint8Array) => {
        pixel.set([26, 28, 31, 255]);
      }),
    } as unknown as WebGLRenderingContext;
    expect(detectBlankWebglFrame(canvas, uniformContext)).toBe(true);

    const variedContext = {
      RGBA: 0x1908,
      UNSIGNED_BYTE: 0x1401,
      readPixels: vi.fn((x, _y, _w, _h, _fmt, _type, pixel: Uint8Array) => {
        pixel.set(x === 0 ? [26, 28, 31, 255] : [40, 82, 127, 255]);
      }),
    } as unknown as WebGLRenderingContext;
    expect(detectBlankWebglFrame(canvas, variedContext)).toBe(false);

    expect(detectBlankWebglFrame(canvas, null)).toBe(false);
  });

  it('disposes the environment and scene tree after every job', async () => {
    const envDispose = vi.fn();
    const deps = makeDeps({
      loadHdrData: vi.fn(async () => ({ dispose: envDispose } as never)),
      pmrem: {
        fromEquirectangular: () => ({
          texture: { dispose: vi.fn() } as never,
          dispose: vi.fn(),
        }),
        dispose: vi.fn(),
      },
    });
    await renderModelThumbnailFrame(makeJob(), deps);
    await renderModelThumbnailFrame(makeJob({ requestId: 'job-2' }), deps);
    expect(envDispose).toHaveBeenCalledTimes(2);
  });
});
