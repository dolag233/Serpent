import { describe, expect, it } from 'vitest';

import {
  countSceneStats,
  formatByteSize,
  formatCount,
  type SceneTreeLike,
  type SceneObjectLike,
} from '../../src/renderer/3d-viewer/model-stats';

function objectNode(partial: Partial<SceneObjectLike> = {}): SceneObjectLike {
  return { type: 'Mesh', ...partial };
}

function sceneWith(...objects: SceneObjectLike[]): SceneTreeLike {
  return {
    traverse(callback) {
      for (const object of objects) callback(object);
    },
  };
}

function indexedGeometry(triangleCount: number): SceneObjectLike['geometry'] {
  return { index: { count: triangleCount * 3 }, attributes: {} };
}

describe('model-stats (Serpent-qvc6 / 3D-13)', () => {
  it('counts indexed and non-indexed triangles and vertices', () => {
    const stats = countSceneStats(
      sceneWith(
        objectNode({
          geometry: indexedGeometry(100),
          material: { type: 'MeshStandardMaterial' },
        }),
        objectNode({
          geometry: { attributes: { position: { count: 30 } } },
          material: null,
        }),
      ),
    );
    // Indexed node: 100 triangles from the index, no position attribute.
    // Non-indexed node: 30 positions = 10 triangles.
    expect(stats.triangles).toBe(110);
    expect(stats.vertices).toBe(30);
  });

  it('counts unique materials and textures across meshes', () => {
    const sharedMaterial = { type: 'MeshStandardMaterial', map: { image: null } };
    const otherMaterial = {
      type: 'MeshStandardMaterial',
      normalMap: { image: { width: 1024, height: 512 } },
      roughnessMap: { image: { width: 512, height: 512 } },
    };
    const stats = countSceneStats(
      sceneWith(
        objectNode({ geometry: indexedGeometry(3), material: sharedMaterial }),
        objectNode({ geometry: indexedGeometry(3), material: sharedMaterial }),
        objectNode({
          geometry: indexedGeometry(3),
          material: [sharedMaterial, otherMaterial],
        }),
      ),
    );
    expect(stats.materials).toBe(2);
    // map + normalMap + roughnessMap → 3 unique textures.
    expect(stats.textures).toBe(3);
    expect(stats.maxTextureEdge).toBe(1024);
  });

  it('counts material array slots and skips empty nodes', () => {
    const stats = countSceneStats(
      sceneWith(
        objectNode(),
        objectNode({ geometry: null, material: [] }),
      ),
    );
    expect(stats.triangles).toBe(0);
    expect(stats.vertices).toBe(0);
    expect(stats.materials).toBe(0);
    expect(stats.textures).toBe(0);
  });

  it('prefers the index count over the position attribute', () => {
    const stats = countSceneStats(
      sceneWith(
        objectNode({
          geometry: {
            index: { count: 6 },
            attributes: { position: { count: 999 } },
          },
          material: null,
        }),
      ),
    );
    expect(stats.triangles).toBe(2);
    expect(stats.vertices).toBe(999);
  });

  it('formats byte sizes in B/KB/MB/GB', () => {
    expect(formatByteSize(512)).toBe('512 B');
    expect(formatByteSize(2048)).toBe('2.0 KB');
    expect(formatByteSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatByteSize(3 * 1024 * 1024 * 1024)).toMatch(/^3\.00 GB$/);
    expect(formatByteSize(Number.NaN)).toBe('0 B');
    expect(formatByteSize(-1)).toBe('0 B');
  });

  it('formats counts with the locale', () => {
    expect(formatCount(1234567, 'en-US')).toBe('1,234,567');
    expect(formatCount(1234.9, 'zh-CN')).toBe('1,234');
    expect(formatCount(Number.NaN, 'en-US')).toBe('0');
  });
});
