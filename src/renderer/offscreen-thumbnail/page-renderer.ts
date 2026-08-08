/**
 * Offscreen thumbnail frame pipeline (slice E, Serpent-hnmg).
 *
 * Renders exactly one frame of a model job into the shared offscreen page:
 * composer → HDRI environment → model load → auto-fit camera → contact
 * shadow → renderOnce → blank check → PNG capture. No rAF loop, no controls,
 * no React — the interactive viewer's render core (scene-composer /
 * loader-registry / camera-policy / ground-shadow) is reused as-is.
 *
 * Determinism: the page forces `setPixelRatio(1)` and renders into a fixed
 * canvas (default 512×512), so the returned PNG is DPR-free regardless of the
 * system scale factor (research §4.8-5 platform measurement is bypassed by
 * design; the paint event remains a Main-side fallback).
 *
 * Unit tests inject structural fakes for the renderer/loaders (same pattern
 * as the 3d-viewer modules); the real wiring lives in `main.ts` of this
 * directory.
 */

import {
  Box3,
  Color,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
} from 'three';
import type { Texture, WebGLRenderer } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import { getBundledHdriPreset } from '../../shared/hdri-presets';
import type { ModelCompanionAsset } from '../../shared/model-companions';
import {
  modelThumbnailRenderRequestSchema,
  type ModelThumbnailErrorCode,
  type ModelThumbnailRenderRequest,
} from '../../shared/model-thumbnail-protocol';
import {
  computeCameraPlacement,
  sphereFromBounds,
} from '../3d-viewer/camera-policy';

import {
  buildEnvironment,
  type EnvironmentHandle,
  type PmremGeneratorLike,
} from '../3d-viewer/environment';
import { setupGroundShadow } from '../3d-viewer/ground-shadow';
import {
  loadModelScene,
  type LoadedModelScene,
} from '../3d-viewer/loader-registry';
import { createSceneComposer } from '../3d-viewer/scene-composer';

/** Fixed neutral backdrop for model thumbnails (consistent across themes). */
export const OFFSCREEN_THUMBNAIL_BACKGROUND = 0x1a1c1f;
/** A custom protocol request must not strand the model render indefinitely. */
export const OFFSCREEN_HDRI_LOAD_TIMEOUT_MS = 5_000;

/** Structural renderer surface (real three WebGLRenderer or test fake). */
export interface FrameRendererLike {
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle: boolean): void;
  render(scene: unknown, camera: unknown): void;
  readonly domElement: HTMLCanvasElement;
  getContext(): WebGLRenderingContext | null;
  /** three r185 stores tone mapping as plain properties (EnvironmentRenderer). */
  toneMapping: number;
  toneMappingExposure: number;
}

export interface FrameEnvironmentDeps {
  /** Loader factory defaulting to the real HDRLoader (no WebGL needed). */
  loadHdrData?: (url: string) => Promise<Texture>;
  pmrem?: PmremGeneratorLike;
  renderer: FrameRendererLike;
}

export interface FrameModelDeps {
  loadModel?: (input: {
    format: 'glb' | 'gltf' | 'fbx' | 'obj' | 'stl';
    sourceUrl: string;
    libraryId: string;
    companionMap: ReadonlyMap<string, ModelCompanionAsset>;
  }) => Promise<LoadedModelScene>;
}

export interface FrameBoundsResult {
  readonly empty: boolean;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface FramePipelineDeps extends FrameEnvironmentDeps, FrameModelDeps {
  /** Defaults to a structural 512×512 canvas with a working 2D context. */
  createCanvas?: () => HTMLCanvasElement;
  /** PNG data-URL capture; defaults to canvas.toDataURL('image/png'). */
  capturePng?: (canvas: HTMLCanvasElement) => string;
  /** Blank-frame detector; defaults to {@link detectBlankWebglFrame}. */
  isBlank?: (canvas: HTMLCanvasElement, context: WebGLRenderingContext | null) => boolean;
  /** World-space bounds of the loaded scene; defaults to Box3.setFromObject. */
  computeBounds?: (scene: unknown) => FrameBoundsResult;
  /** Structured logging hook (page console, forwarded by Main diagnostics). */
  log?: (message: string, context?: Record<string, unknown>) => void;
  /** Injectable HDRI deadline for tests; production keeps the short fallback. */
  hdriLoadTimeoutMs?: number;
  /**
   * Offscreen Chromium can leave custom-protocol HDR requests pending forever.
   * The ground-shadow key light remains available as a deterministic fallback.
   */
  enableHdri?: boolean;
}

export type FrameOutcome =
  | {
      status: 'ok';
      pngBase64: string;
      width: number;
      height: number;
    }
  | {
      status: 'ok';
      frames: Array<{
        view: [number, number, number];
        pngBase64: string;
        width: number;
        height: number;
      }>;
    }
  | {
      status: 'failed';
      errorCode: ModelThumbnailErrorCode;
      reason?: string;
    };

/**
 * Render one job and capture the frame. Cleans up every GPU resource it
 * mounted (environment + scene tree) before returning, so the shared
 * renderer/canvas is ready for the next job.
 */
export async function renderModelThumbnailFrame(
  input: ModelThumbnailRenderRequest,
  deps: FramePipelineDeps,
): Promise<FrameOutcome> {
  const job = modelThumbnailRenderRequestSchema.safeParse(input);
  if (!job.success) {
    return { status: 'failed', errorCode: 'MODEL_LOAD_FAILED', reason: 'malformed render job' };
  }
  const { width, height } = job.data;
  const log = deps.log ?? (() => {});
  const canvas = deps.createCanvas?.() ?? deps.renderer.domElement;

  // Fixed, DPR-free drawing buffer (research §4.8-5).
  deps.renderer.setPixelRatio(1);
  deps.renderer.setSize(width, height, false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, width / height, 0.1, 5_000);
  // The composer's public surface is typed against the real WebGLRenderer;
  // production passes the real one, tests inject structural fakes.
  const composer = createSceneComposer({
    renderer: deps.renderer as unknown as WebGLRenderer,
    camera,
    scene,
  });
  composer.setBackground(new Color(OFFSCREEN_THUMBNAIL_BACKGROUND));
  log('offscreen-thumbnail.stage.renderer-ready');

  let environment: EnvironmentHandle | null = null;
  try {
    // Environment failure degrades to the contact-shadow key light only — the
    // model stays visible (3D-11: not black), same policy as the viewer.
    const preset = deps.enableHdri === false
      ? null
      : getBundledHdriPreset(job.data.hdriPresetId);
    if (preset) {
      try {
        log('offscreen-thumbnail.stage.hdri-loading', { presetId: preset.id });
        environment = await promiseWithTimeout(
          loadHdrEnvironmentForFrame(`serpent://app-assets/hdri/${preset.fileName}`, {
            renderer: deps.renderer,
            pmrem: deps.pmrem,
            loadHdrData: deps.loadHdrData,
          }),
          deps.hdriLoadTimeoutMs ?? OFFSCREEN_HDRI_LOAD_TIMEOUT_MS,
          `HDRI load timed out: ${preset.id}`,
        );
        composer.setEnvironment(environment.environmentTexture);
        log('offscreen-thumbnail.stage.hdri-ready', { presetId: preset.id });
      } catch (error) {
        log('offscreen-thumbnail.hdri-failed', {
          presetId: preset.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const companionMap = new Map(
      job.data.companionMap.map((companion) => [companion.relativeFilePath, companion]),
    );
    let loaded: LoadedModelScene;
    try {
      log('offscreen-thumbnail.stage.model-loading', { format: job.data.format });
      loaded = await (deps.loadModel ?? loadModelScene)({
        format: job.data.format,
        sourceUrl: job.data.renderUrl,
        libraryId: job.data.libraryId,
        companionMap,
      });
      log('offscreen-thumbnail.stage.model-ready', { format: job.data.format });
    } catch (error) {
      return {
        status: 'failed',
        errorCode: 'MODEL_LOAD_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    const computeBounds = deps.computeBounds ?? ((scene: unknown) => {
      const bounds = new Box3().setFromObject(scene as Parameters<Box3['setFromObject']>[0]);
      return {
        empty: bounds.isEmpty(),
        min: bounds.min.toArray(),
        max: bounds.max.toArray(),
      };
    });
    const bounds = computeBounds(loaded.scene);
    if (bounds.empty) {
      return { status: 'failed', errorCode: 'MODEL_EMPTY_SCENE' };
    }
    composer.scene.add(loaded.scene);

    // Auto-fit (3D-02) + soft contact shadow (3D-07).
    const sphere = sphereFromBounds({
      min: bounds.min,
      max: bounds.max,
    });
    const directions: ReadonlyArray<readonly [number, number, number] | undefined> =
      job.data.views && job.data.views.length > 0
        ? job.data.views
        : [undefined];
    setupGroundShadow(composer.scene, sphere, bounds.min[1]);

    const renderOneFrame = (
      direction: readonly [number, number, number] | undefined,
    ): { pngBase64: string } => {
      const placement = computeCameraPlacement({
        bounds: sphere,
        viewportAspect: width / height,
        ...(direction === undefined ? {} : { direction }),
      });
      camera.position.set(...placement.position);
      if (direction !== undefined && direction[1] > 0.98) {
        // Top view: three.js "up" must not be parallel to the view axis.
        camera.up.set(0, 0, -1);
      } else {
        camera.up.set(0, 1, 0);
      }
      camera.lookAt(...placement.target);
      // Exactly one frame — no rAF, no throttling dependency (research §4.7).
      composer.renderOnce();
      const dataUrl = (deps.capturePng ?? ((target) => target.toDataURL('image/png')))(canvas);
      if (!dataUrl.startsWith('data:image/png;base64,')) {
        throw new Error('canvas capture produced no PNG data URL');
      }
      return { pngBase64: dataUrl.slice('data:image/png;base64,'.length) };
    };

    if (job.data.views && job.data.views.length > 0) {
      // Serpent-6w40: multi-view render (AI four views) — each direction
      // renders one frame; the worker tiles them afterwards.
      const frames: Array<{
        view: [number, number, number];
        pngBase64: string;
        width: number;
        height: number;
      }> = [];
      for (const view of job.data.views) {
        try {
          const frame = renderOneFrame(view);
          frames.push({ view, pngBase64: frame.pngBase64, width, height });
        } catch {
          return {
            status: 'failed',
            errorCode: 'MODEL_FRAME_INVALID',
            reason: 'canvas capture produced no PNG data URL',
          };
        }
      }
      // Frame readback (preserveDrawingBuffer, set by the page's renderer).
      const blank = (deps.isBlank ?? detectBlankWebglFrame)(canvas, deps.renderer.getContext());
      if (blank) {
        return {
          status: 'failed',
          errorCode: 'MODEL_BLANK_FRAME',
          reason: 'rendered frame is uniform (readback or render failure)',
        };
      }
      return { status: 'ok', frames };
    }

    log('offscreen-thumbnail.stage.rendering');
    let pngBase64: string;
    try {
      pngBase64 = renderOneFrame(undefined).pngBase64;
    } catch {
      return {
        status: 'failed',
        errorCode: 'MODEL_FRAME_INVALID',
        reason: 'canvas capture produced no PNG data URL',
      };
    }
    log('offscreen-thumbnail.stage.rendered');

    // Frame readback (preserveDrawingBuffer, set by the page's renderer).
    const blank = (deps.isBlank ?? detectBlankWebglFrame)(canvas, deps.renderer.getContext());
    if (blank) {
      return {
        status: 'failed',
        errorCode: 'MODEL_BLANK_FRAME',
        reason: 'rendered frame is uniform (readback or render failure)',
      };
    }
    return {
      status: 'ok',
      pngBase64,
      width,
      height,
    };
  } finally {
    environment?.dispose();
    composer.dispose();
  }
}

function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Real HDRI pipeline for the page (mirrors the viewer's environment module). */
async function loadHdrEnvironmentForFrame(
  url: string,
  deps: FrameEnvironmentDeps,
): Promise<EnvironmentHandle> {
  const texture = await (deps.loadHdrData ?? ((target: string) => new HDRLoader().loadAsync(target)))(url);
  // In production `renderer` is a real WebGLRenderer; tests inject `pmrem`,
  // so the constructor below never runs against a fake.
  const pmrem = deps.pmrem ?? new PMREMGenerator(deps.renderer as unknown as WebGLRenderer);
  return buildEnvironment({
    hdrTexture: texture,
    pmrem,
    renderer: deps.renderer,
  });
}

/**
 * Blank-frame detector: sample a coarse grid of the drawing buffer; a frame
 * whose samples are ALL identical carries no render (uniform background or a
 * failed readback). Requires `preserveDrawingBuffer: true` on the renderer.
 */
export function detectBlankWebglFrame(
  canvas: HTMLCanvasElement,
  context: WebGLRenderingContext | null,
): boolean {
  if (!context) return false; // Cannot verify — trust the capture.
  const { width, height } = canvas;
  if (width < 4 || height < 4) return true;
  const step = Math.max(16, Math.floor(Math.min(width, height) / 16));
  const pixel = new Uint8Array(4);
  let reference: Uint8Array | null = null;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixel);
      if (reference === null) {
        reference = new Uint8Array(pixel);
        continue;
      }
      for (let channel = 0; channel < 4; channel += 1) {
        if (pixel[channel] !== reference[channel]) return false;
      }
    }
  }
  return true;
}

