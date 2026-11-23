import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshPhongMaterial, MeshStandardMaterial } from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

import { loadModelScene } from '../../src/renderer/3d-viewer/loader-registry';

const sourceUrl = 'serpent://source/library/asset?revision=revision';

describe('native FBX model loading', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes the source revision to FBXLoader and upgrades materials', async () => {
    const scene = new Group();
    const mesh = new Mesh(new BoxGeometry(), new MeshPhongMaterial());
    scene.add(mesh);
    const loadAsync = vi.spyOn(FBXLoader.prototype, 'loadAsync').mockImplementation(async function (this: FBXLoader) {
      this.manager.itemStart(sourceUrl);
      this.manager.itemEnd(sourceUrl);
      return scene;
    });
    const loaded = await loadModelScene({ format: 'fbx', sourceUrl, libraryId: 'library', companionMap: new Map() });
    expect(loadAsync).toHaveBeenCalledWith(sourceUrl);
    expect(loaded.scene).toBe(scene);
    expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
    expect(mesh.castShadow).toBe(true);
  });

  it('remaps companion requests and waits for images before returning geometry', async () => {
    let finishTexture: (() => void) | undefined;
    vi.spyOn(FBXLoader.prototype, 'loadAsync').mockImplementation(async function (this: FBXLoader) {
      this.manager.itemStart(sourceUrl);
      expect(this.manager.getHandler('.tga')).not.toBeNull();
      expect(this.manager.getHandler('.tiff')).not.toBeNull();
      expect(this.manager.resolveURL(sourceUrl)).toBe(sourceUrl);
      const companionUrl = this.manager.resolveURL(this.resourcePath + 'albedo.png');
      expect(companionUrl).toBe('serpent://source/library/texture?revision=texture-revision');
      this.manager.itemStart(companionUrl);
      this.manager.itemEnd(sourceUrl);
      finishTexture = () => this.manager.itemEnd(companionUrl);
      return new Group();
    });
    const ready = vi.fn();
    const load = loadModelScene({
      format: 'fbx', sourceUrl, libraryId: 'library',
      companionMap: new Map([['albedo.png', {
        relativeFilePath: 'albedo.png', assetId: 'texture', revisionId: 'texture-revision', extension: '.png',
      }]]),
    }).then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    finishTexture?.();
    await load;
    expect(ready).toHaveBeenCalledOnce();
  });

  it('propagates native parsing failures', async () => {
    vi.spyOn(FBXLoader.prototype, 'loadAsync').mockRejectedValue(new Error('invalid FBX'));
    await expect(loadModelScene({
      format: 'fbx', sourceUrl, libraryId: 'library', companionMap: new Map(),
    })).rejects.toThrow('invalid FBX');
  });

  it('finishes a textureless FBX when FileLoader shares an in-flight read', async () => {
    const scene = new Group();
    // The shared request registers no items on this FBXLoader's manager.
    vi.spyOn(FBXLoader.prototype, 'loadAsync').mockResolvedValue(scene);
    const loaded = await loadModelScene({ format: 'fbx', sourceUrl, libraryId: 'library', companionMap: new Map() });
    expect(loaded.scene).toBe(scene);
  });
});
