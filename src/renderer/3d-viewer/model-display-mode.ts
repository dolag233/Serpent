import {
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Material,
  type Scene,
} from 'three';

/**
 * Model display modes (Serpent-fkhe): PBR / PBR+wireframe / gray-shaded /
 * gray-shaded+wireframe / pure wireframe.
 *
 * Pure function over a three Scene so it is unit-testable without a renderer:
 * - `pbr` restores materials (wireframe off, no override);
 * - `pbr-wireframe` toggles `material.wireframe` on the real materials so
 *   textures stay visible under the overlay;
 * - the shaded modes install `scene.overrideMaterial` (a neutral standard
 *   material), which never mutates the model's own materials;
 * - `wireframe` uses a basic unlit material for crisp lines.
 */
export const MODEL_DISPLAY_MODES = [
  'pbr',
  'pbr-wireframe',
  'shaded',
  'shaded-wireframe',
  'wireframe',
] as const;

export type ModelDisplayMode = (typeof MODEL_DISPLAY_MODES)[number];

export const DEFAULT_DISPLAY_MODE: ModelDisplayMode = 'pbr';

/** Neutral gray used by the shaded (gray) modes. */
export const SHADED_GRAY = 0x9aa0a6;
/** Wire color for the pure-wireframe mode. */
export const WIREFRAME_GRAY = 0xcccccc;

function setWireframeOn(material: Material, wireframe: boolean): void {
  if ('wireframe' in material) material.wireframe = wireframe;
}

function setAllWireframe(material: Material | Material[], wireframe: boolean): void {
  if (Array.isArray(material)) {
    for (const entry of material) setWireframeOn(entry, wireframe);
  } else {
    setWireframeOn(material, wireframe);
  }
}

function resetScene(scene: Scene): void {
  if (scene.overrideMaterial !== null) {
    scene.overrideMaterial.dispose();
    scene.overrideMaterial = null;
  }
  scene.traverse((object) => {
    const mesh = object as { material?: Material | Material[] };
    if (mesh.material !== undefined) setAllWireframe(mesh.material, false);
  });
}

/** Apply a display mode; always idempotent and safe to call repeatedly. */
export function applyDisplayMode(scene: Scene, mode: ModelDisplayMode): void {
  resetScene(scene);
  switch (mode) {
    case 'pbr':
      return;
    case 'pbr-wireframe':
      scene.traverse((object) => {
        const mesh = object as { material?: Material | Material[] };
        if (mesh.material !== undefined) setAllWireframe(mesh.material, true);
      });
      return;
    case 'shaded':
      scene.overrideMaterial = new MeshStandardMaterial({
        color: SHADED_GRAY,
        roughness: 0.85,
        metalness: 0,
      });
      return;
    case 'shaded-wireframe':
      scene.overrideMaterial = new MeshStandardMaterial({
        color: SHADED_GRAY,
        roughness: 0.85,
        metalness: 0,
        wireframe: true,
      });
      return;
    case 'wireframe':
      scene.overrideMaterial = new MeshBasicMaterial({
        color: WIREFRAME_GRAY,
        wireframe: true,
      });
      return;
  }
}
