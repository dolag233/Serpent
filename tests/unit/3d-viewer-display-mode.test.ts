import { describe, expect, it } from 'vitest';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Scene,
} from 'three';

import {
  DEFAULT_DISPLAY_MODE,
  MODEL_DISPLAY_MODES,
  SHADED_GRAY,
  WIREFRAME_GRAY,
  applyDisplayMode,
} from '../../src/renderer/3d-viewer/model-display-mode';

function sceneWithMaterials(): { scene: Scene; material: MeshStandardMaterial } {
  const scene = new Scene();
  const material = new MeshStandardMaterial({ color: 0xff0000 });
  scene.add(new Mesh(new BoxGeometry(), material));
  return { scene, material };
}

describe('model display modes (Serpent-fkhe)', () => {
  it('defaults to PBR and lists all five modes', () => {
    expect(DEFAULT_DISPLAY_MODE).toBe('pbr');
    expect(MODEL_DISPLAY_MODES).toEqual([
      'pbr',
      'pbr-wireframe',
      'shaded',
      'shaded-wireframe',
      'wireframe',
    ]);
  });

  it('pbr restores materials (no override, no wireframe)', () => {
    const { scene, material } = sceneWithMaterials();
    applyDisplayMode(scene, 'shaded');
    applyDisplayMode(scene, 'pbr');
    expect(scene.overrideMaterial).toBeNull();
    expect(material.wireframe).toBe(false);
  });

  it('pbr-wireframe toggles wireframe on the real materials only', () => {
    const { scene, material } = sceneWithMaterials();
    applyDisplayMode(scene, 'pbr-wireframe');
    expect(scene.overrideMaterial).toBeNull();
    expect(material.wireframe).toBe(true);
    applyDisplayMode(scene, 'pbr');
    expect(material.wireframe).toBe(false);
  });

  it('shaded installs a neutral gray override without mutating materials', () => {
    const { scene, material } = sceneWithMaterials();
    applyDisplayMode(scene, 'shaded');
    const override = scene.overrideMaterial as MeshStandardMaterial;
    expect(override).toBeInstanceOf(MeshStandardMaterial);
    expect(override.color.getHex()).toBe(SHADED_GRAY);
    expect(override.wireframe).toBe(false);
    expect(material.color.getHex()).toBe(0xff0000);
    expect(material.wireframe).toBe(false);
  });

  it('shaded-wireframe and wireframe set the override wireframe flag', () => {
    const { scene } = sceneWithMaterials();
    applyDisplayMode(scene, 'shaded-wireframe');
    expect((scene.overrideMaterial as MeshStandardMaterial).wireframe).toBe(true);
    applyDisplayMode(scene, 'wireframe');
    const wire = scene.overrideMaterial as MeshBasicMaterial;
    expect(wire).toBeInstanceOf(MeshBasicMaterial);
    expect(wire.wireframe).toBe(true);
    expect(wire.color.getHex()).toBe(WIREFRAME_GRAY);
  });

  it('supports multi-material meshes', () => {
    const scene = new Scene();
    const first = new MeshStandardMaterial();
    const second = new MeshStandardMaterial();
    scene.add(new Mesh(new BoxGeometry(), [first, second]));
    applyDisplayMode(scene, 'pbr-wireframe');
    expect(first.wireframe).toBe(true);
    expect(second.wireframe).toBe(true);
  });
});
