/**
 * Scene composer — the renderer-agnostic 3D scene assembly core.
 *
 * Shared by the interactive viewer (slice C, this file's main consumer) and
 * the offscreen thumbnail renderer (slice E): it owns the scene + camera
 * lifecycle, applies the neutral tone mapping / exposure policy (3D-10,
 * `HDRI_TONE_MAPPING`), and exposes exactly the operations both consumers
 * need — set background/environment, resize, render one frame, dispose.
 *
 * Ownership contract:
 * - the renderer is created and disposed by the CALLER (viewer surface /
 *   offscreen window), never here;
 * - the environment texture stays owned by the `EnvironmentHandle` that
 *   produced it (disposed by that handle);
 * - `dispose()` releases everything mounted in the scene tree
 *   (geometries/materials/textures) via {@link disposeSceneTree} — including
 *   the loaded model and the ground/light helpers the viewer adds.
 *
 * Real three types on the public surface; unit tests inject structural fakes.
 */

import {
  PerspectiveCamera,
  Scene,
} from 'three';
import type { Color, Texture, WebGLRenderer } from 'three';

import {
  DEFAULT_LIGHT_INTENSITY,
  clampLightIntensity,
} from './light-intensity';
import {
  applyDisplayMode,
  type ModelDisplayMode,
} from './model-display-mode';
import { HDRI_TONE_MAPPING } from './environment';
import { CAMERA_FOV_DEGREES } from './camera-policy';
import { MATERIAL_TEXTURE_SLOTS } from './model-stats';

export interface SceneComposerOptions {
  readonly renderer: WebGLRenderer;
  /** Defaults to a 45° perspective camera. */
  readonly camera?: PerspectiveCamera;
  /** Defaults to an empty scene. */
  readonly scene?: Scene;
}

export interface SceneComposer {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  /** Theme background (3D-06); null renders the default clear color. */
  setBackground(background: Color | null): void;
  /** IBL environment (3D-09); the caller keeps ownership of the texture. */
  setEnvironment(environment: Texture | null): void;
  /**
   * Environment light intensity (replaces the old "exposure" semantics):
   * scales `scene.environment.intensity`, tone mapping stays neutral.
   */
  setLightIntensity(intensity: number): void;
  /**
   * Horizontal environment rotation (radians, around Y): right-drag or
   * Ctrl+left-drag in the viewer rotates the light source without moving the
   * model (Serpent-v4jt / Serpent-xjcy).
   */
  setEnvironmentRotation(yaw: number): void;
  /** Display mode (PBR / wireframe / gray-shaded…, Serpent-fkhe). */
  setDisplayMode(mode: ModelDisplayMode): void;
  /** Update camera aspect + renderer size (drawing buffer only). */
  resize(width: number, height: number): void;
  /** Render exactly one frame — the offscreen thumbnail path's only call. */
  renderOnce(): void;
  /** Release every geometry/material/texture mounted in the scene. */
  dispose(): void;
}

export function createSceneComposer(options: SceneComposerOptions): SceneComposer {
  const scene = options.scene ?? new Scene();
  const camera =
    options.camera ??
    new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.1, 5_000);
  const renderer = options.renderer;
  let lightIntensity = DEFAULT_LIGHT_INTENSITY;

  // Slice D policy: neutral tone mapping (color-faithful under IBL) with the
  // tone-mapping exposure pinned at its neutral default — the user-facing
  // control is environment LIGHT INTENSITY, not exposure.
  renderer.toneMapping = HDRI_TONE_MAPPING;
  renderer.toneMappingExposure = DEFAULT_LIGHT_INTENSITY;

  return {
    renderer,
    scene,
    camera,
    setBackground(background) {
      scene.background = background;
    },
    setEnvironment(environment) {
      scene.environment = environment;
      scene.environmentIntensity = lightIntensity;
    },
    setLightIntensity(intensity) {
      lightIntensity = clampLightIntensity(intensity);
      scene.environmentIntensity = lightIntensity;
    },
    setEnvironmentRotation(yaw) {
      // scene.environmentRotation (Euler) is the three-native way to rotate
      // the environment light without touching the model.
      scene.environmentRotation.y = yaw;
    },
    setDisplayMode(mode) {
      applyDisplayMode(scene, mode);
    },
    resize(width, height) {
      const safeWidth = Math.max(1, width);
      const safeHeight = Math.max(1, height);
      camera.aspect = safeWidth / safeHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(safeWidth, safeHeight, false);
    },
    renderOnce() {
      renderer.render(scene, camera);
    },
    dispose() {
      disposeSceneTree(scene);
    },
  };
}

/** Minimal structural scene-graph surface for disposal (real + fake objects). */
export interface DisposableLike {
  dispose(): void;
}

export interface SceneTreeObjectLike {
  /** Present on every three Object3D; enables structural assignment of real scene objects. */
  readonly type?: string;
  children?: readonly SceneTreeObjectLike[];
  geometry?: DisposableLike | null;
  material?: DisposableLike | readonly DisposableLike[] | null;
}

/**
 * Release every GPU resource mounted under `root`: mesh geometries,
 * materials and their texture slots. Safe to call repeatedly (three's
 * dispose is idempotent) and on shared resources (glTF meshes share
 * materials; double-dispose is harmless).
 */
export function disposeSceneTree(root: SceneTreeObjectLike): void {
  const visit = (object: SceneTreeObjectLike): void => {
    object.geometry?.dispose();
    const material = object.material;
    if (material) {
      for (const single of Array.isArray(material) ? material : [material]) {
        disposeMaterialTextureSlots(single);
        single.dispose();
      }
    }
    for (const child of object.children ?? []) {
      visit(child);
    }
  };
  visit(root);
}

function disposeMaterialTextureSlots(material: DisposableLike): void {
  const slots = material as unknown as Record<string, unknown>;
  for (const slot of MATERIAL_TEXTURE_SLOTS) {
    const texture = slots[slot];
    if (
      texture &&
      typeof texture === 'object' &&
      typeof (texture as DisposableLike).dispose === 'function'
    ) {
      (texture as DisposableLike).dispose();
    }
  }
}
