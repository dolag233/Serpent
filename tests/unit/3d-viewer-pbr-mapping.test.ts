import { describe, expect, it, vi } from 'vitest';
import type { Texture } from 'three';

import {
  DEFAULT_METALNESS,
  DEFAULT_MTL_COLOR,
  DEFAULT_ROUGHNESS,
  STL_DEFAULT_COLORS,
  mapPhongToStandard,
  stlDefaultMaterial,
  type PhongLikeMaterialInput,
} from '../../src/renderer/3d-viewer/pbr-mapping';

function fakeTexture(): Texture {
  return { dispose: vi.fn() } as unknown as Texture;
}

describe('mapPhongToStandard (Serpent-v363 / 3D-11 / §5)', () => {
  it('maps the full MTL channel matrix to metal-rough standard params', () => {
    const albedo = fakeTexture();
    const specular = fakeTexture();
    const bump = fakeTexture();
    const normal = fakeTexture();
    const alpha = fakeTexture();
    const emissiveMap = fakeTexture();

    const result = mapPhongToStandard({
      color: 0x123456,
      map: albedo,
      specularMap: specular,
      bumpMap: bump,
      normalMap: normal,
      alphaMap: alpha,
      transparent: true,
      opacity: 0.5,
      emissive: 0xabcdef,
      emissiveMap,
    });

    expect(result.color).toBe(0x123456);
    expect(result.map).toBe(albedo);
    // map_Ks has no metal-rough equivalent; specular strength approximates
    // metalness (spec §5 "specular 近似").
    expect(result.metalnessMap).toBe(specular);
    expect(result.bumpMap).toBe(bump);
    expect(result.normalMap).toBe(normal);
    expect(result.alphaMap).toBe(alpha);
    expect(result.transparent).toBe(true);
    expect(result.opacity).toBe(0.5);
    expect(result.emissive).toBe(0xabcdef);
    expect(result.emissiveMap).toBe(emissiveMap);
  });

  it('applies the neutral metal-rough defaults when MTL carries no PBR data', () => {
    const result = mapPhongToStandard({});
    expect(result.metalness).toBe(DEFAULT_METALNESS);
    expect(result.roughness).toBe(DEFAULT_ROUGHNESS);
    expect(result.color).toBe(DEFAULT_MTL_COLOR);
    expect(result.map).toBeNull();
    expect(result.metalnessMap).toBeNull();
    expect(result.normalMap).toBeNull();
    expect(result.bumpMap).toBeNull();
    expect(result.alphaMap).toBeNull();
    expect(result.emissive).toBe(0x000000);
    expect(result.transparent).toBe(false);
    expect(result.opacity).toBe(1);
  });

  it('treats opacity below 1 as transparent and clamps opacity to [0, 1]', () => {
    expect(mapPhongToStandard({ opacity: 0.25 }).transparent).toBe(true);
    expect(mapPhongToStandard({ opacity: 0.25 }).opacity).toBe(0.25);
    expect(mapPhongToStandard({ opacity: 3 }).opacity).toBe(1);
    expect(mapPhongToStandard({ opacity: -1 }).opacity).toBe(0);
    expect(mapPhongToStandard({ opacity: -1 }).transparent).toBe(true);
  });

  it('keeps explicit transparency flags and is side-effect free', () => {
    const input: PhongLikeMaterialInput = Object.freeze({
      color: 0xffffff,
      transparent: false,
      opacity: 0.25,
    });
    const result = mapPhongToStandard(input);
    expect(result.transparent).toBe(false);
    expect(result.opacity).toBe(0.25);
  });
});

describe('stlDefaultMaterial (Serpent-v363 / §5)', () => {
  it('uses a gray-blue neutral differentiated per theme', () => {
    const light = stlDefaultMaterial('light');
    const dark = stlDefaultMaterial('dark');

    expect(light.color).toBe(STL_DEFAULT_COLORS.light);
    expect(dark.color).toBe(STL_DEFAULT_COLORS.dark);
    expect(STL_DEFAULT_COLORS.light).not.toBe(STL_DEFAULT_COLORS.dark);
    // Both read as gray-blue midtones against their theme background.
    expect(STL_DEFAULT_COLORS.light).toBe(0x5f6d7e);
    expect(STL_DEFAULT_COLORS.dark).toBe(0x9aa9bb);

    for (const material of [light, dark]) {
      expect(material.map).toBeNull();
      expect(material.normalMap).toBeNull();
      expect(material.bumpMap).toBeNull();
      expect(material.metalnessMap).toBeNull();
      expect(material.alphaMap).toBeNull();
      expect(material.metalness).toBe(DEFAULT_METALNESS);
      expect(material.roughness).toBe(DEFAULT_ROUGHNESS);
      expect(material.transparent).toBe(false);
      expect(material.opacity).toBe(1);
    }
  });
});
