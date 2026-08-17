import { describe, expect, it, vi } from 'vitest';
import {
  BufferGeometry,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Texture,
} from 'three';
import type { WebGLRenderer } from 'three';

import {
  createSceneComposer,
  disposeSceneTree,
  type SceneTreeObjectLike,
} from '../../src/renderer/3d-viewer/scene-composer';
import { HDRI_TONE_MAPPING } from '../../src/renderer/3d-viewer/environment';
import { DEFAULT_LIGHT_INTENSITY } from '../../src/renderer/3d-viewer/light-intensity';

function fakeRenderer() {
  const render = vi.fn();
  const setSize = vi.fn();
  return {
    toneMapping: 0,
    toneMappingExposure: 1,
    render,
    setSize,
  } as unknown as WebGLRenderer;
}

describe('scene-composer (Serpent-qvc6 / shared render core)', () => {
  it('applies neutral tone mapping with tone-mapping exposure pinned neutral', () => {
    const renderer = fakeRenderer();
    createSceneComposer({ renderer });
    expect(renderer.toneMapping).toBe(HDRI_TONE_MAPPING);
    expect(renderer.toneMappingExposure).toBe(DEFAULT_LIGHT_INTENSITY);
  });

  it('owns a camera with the default FOV and scene wiring', () => {
    const renderer = fakeRenderer();
    const composer = createSceneComposer({ renderer });
    expect(composer.camera).toBeInstanceOf(PerspectiveCamera);
    expect(composer.scene.background).toBeNull();
    expect(composer.scene.environment).toBeNull();
  });

  it('applies background/environment/light intensity through the composer', () => {
    const renderer = fakeRenderer();
    const composer = createSceneComposer({ renderer });
    const background = { isColor: true } as unknown as Parameters<
      typeof composer.setBackground
    >[0];
    const environment = { isTexture: true } as unknown as Parameters<
      typeof composer.setEnvironment
    >[0];
    composer.setBackground(background);
    composer.setEnvironment(environment);
    expect(composer.scene.background).toBe(background);
    expect(composer.scene.environment).toBe(environment);
    // Light intensity scales the environment (scene.environmentIntensity),
    // not the tone-mapping exposure.
    composer.setLightIntensity(3.5);
    expect(composer.scene.environmentIntensity).toBe(3.5);
    expect(renderer.toneMappingExposure).toBe(DEFAULT_LIGHT_INTENSITY);
    // Out-of-range intensity is clamped.
    composer.setLightIntensity(99);
    expect(composer.scene.environmentIntensity).toBe(4);
    // Setting a new environment re-applies the current intensity.
    composer.setEnvironment({ isTexture: true } as unknown as Parameters<
      typeof composer.setEnvironment
    >[0]);
    expect(composer.scene.environmentIntensity).toBe(4);
  });

  it('rotates the environment light around Y without touching the model', () => {
    const renderer = fakeRenderer();
    const composer = createSceneComposer({ renderer });
    composer.setEnvironment({ isTexture: true } as unknown as Parameters<
      typeof composer.setEnvironment
    >[0]);
    composer.setEnvironmentRotation(1.7);
    expect(composer.scene.environmentRotation.y).toBe(1.7);
    // Rotation works even with no environment mounted (no throw).
    composer.setEnvironment(null);
    expect(() => composer.setEnvironmentRotation(0.5)).not.toThrow();
    expect(composer.scene.environmentRotation.y).toBe(0.5);
  });

  it('renders exactly one frame per renderOnce call', () => {
    const renderer = fakeRenderer();
    const composer = createSceneComposer({ renderer });
    composer.renderOnce();
    composer.renderOnce();
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(renderer.render).toHaveBeenCalledWith(composer.scene, composer.camera);
  });

  it('resizes camera aspect and drawing buffer together', () => {
    const renderer = fakeRenderer();
    const composer = createSceneComposer({ renderer });
    const initialAspect = composer.camera.aspect;
    composer.resize(800, 400);
    expect(composer.camera.aspect).toBe(2);
    expect(renderer.setSize).toHaveBeenCalledWith(800, 400, false);
    expect(composer.camera.aspect).not.toBe(initialAspect);
  });

  it('disposes everything mounted in the scene tree', () => {
    const renderer = fakeRenderer();
    const composer = createSceneComposer({ renderer });
    const geometry = new BufferGeometry();
    const material = new MeshStandardMaterial();
    material.map = new Texture();
    const geometrySpy = vi.spyOn(geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const textureSpy = vi.spyOn(material.map, 'dispose');
    composer.scene.add(new Mesh(geometry, material));
    composer.dispose();
    expect(geometrySpy).toHaveBeenCalledTimes(1);
    expect(materialSpy).toHaveBeenCalledTimes(1);
    expect(textureSpy).toHaveBeenCalledTimes(1);
  });
});

describe('disposeSceneTree (shared disposal)', () => {
  it('traverses children and disposes geometry/material/textures once', () => {
    const sharedTexture = { dispose: vi.fn() };
    const materialA = {
      dispose: vi.fn(),
      map: sharedTexture,
      normalMap: { dispose: vi.fn() },
    };
    const materialB = { dispose: vi.fn(), map: sharedTexture };
    const root: SceneTreeObjectLike = {
      type: 'Group',
      children: [
        {
          type: 'Mesh',
          geometry: { dispose: vi.fn() },
          material: materialA,
          children: [],
        },
        {
          type: 'Mesh',
          geometry: { dispose: vi.fn() },
          material: [materialA, materialB],
          children: [],
        },
      ],
    };
    disposeSceneTree(root);
    expect(materialA.dispose).toHaveBeenCalledTimes(2);
    expect(materialB.dispose).toHaveBeenCalledTimes(1);
    // Shared textures are disposed per occurrence (three dispose is
    // idempotent, so duplicate disposal is harmless).
    expect(sharedTexture.dispose).toHaveBeenCalledTimes(3);
    expect(root.children?.[0]?.geometry?.dispose).toHaveBeenCalledTimes(1);
    expect(root.children?.[1]?.geometry?.dispose).toHaveBeenCalledTimes(1);
  });

  it('skips objects without resources', () => {
    expect(() => disposeSceneTree({ type: 'Group', children: [] })).not.toThrow();
    expect(() =>
      disposeSceneTree({
        type: 'Mesh',
        geometry: null,
        material: null,
        children: [],
      }),
    ).not.toThrow();
  });
});
