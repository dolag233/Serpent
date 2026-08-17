import { describe, expect, it } from 'vitest';

import type { ModelCompanionAsset } from '../../src/shared/model-companions';
import {
  collectObjMtllibRefs,
  extractMtlTexturePath,
  normalizeCompanionPath,
  remapCompanionUrl,
  remapCompanionUrlByBasename,
  rewriteGltfUris,
  rewriteMtlTextureRefs,
  serpentPreviewUrl,
  serpentSourceUrl,
} from '../../src/renderer/3d-viewer/url-remap';

const companion = (
  relativeFilePath: string,
  assetId: string,
  revisionId = 'rev-1',
): ModelCompanionAsset => ({
  relativeFilePath,
  assetId,
  revisionId,
  extension: relativeFilePath.slice(relativeFilePath.lastIndexOf('.')),
});

const companionMap = new Map<string, ModelCompanionAsset>([
  ['props/robot/textures/albedo.png', companion('props/robot/textures/albedo.png', 'asset-albedo')],
  ['textures/albedo.png', companion('textures/albedo.png', 'asset-albedo')],
  ['textures/normal.png', companion('textures/normal.png', 'asset-normal')],
  ['robot.mtl', companion('robot.mtl', 'asset-mtl')],
  ['props/robot/tex/normal.png', companion('props/robot/tex/normal.png', 'asset-normal-subdir')],
]);

describe('url-remap (Serpent-qvc6 / 3D-12)', () => {
  it('builds serpent://preview and serpent://source URLs', () => {
    expect(serpentPreviewUrl('lib-1', 'art-9')).toBe(
      'serpent://preview/lib-1/art-9',
    );
    expect(serpentSourceUrl('lib-1', 'asset-1')).toBe(
      'serpent://source/lib-1/asset-1',
    );
    expect(serpentSourceUrl('lib-1', 'asset-1', 'rev a/b')).toBe(
      'serpent://source/lib-1/asset-1?revision=rev%20a%2Fb',
    );
  });

  it('normalizes companion paths (slashes, ./ prefix, duplicates)', () => {
    expect(normalizeCompanionPath('./textures/albedo.png')).toBe(
      'textures/albedo.png',
    );
    expect(normalizeCompanionPath('a//b/./c.png')).toBe('a/b/c.png');
    expect(normalizeCompanionPath('a\\b\\c.png')).toBe('a/b/c.png');
  });

  it('rejects absolute and traversal paths', () => {
    expect(normalizeCompanionPath('/etc/passwd')).toBeNull();
    expect(normalizeCompanionPath('../secret.png')).toBeNull();
    expect(normalizeCompanionPath('a/../../secret.png')).toBeNull();
    expect(normalizeCompanionPath('')).toBeNull();
    expect(normalizeCompanionPath('.')).toBeNull();
  });

  it('remaps exact relative paths through the companion map', () => {
    expect(
      remapCompanionUrl({
        relativePath: 'textures/normal.png',
        libraryId: 'lib-1',
        companionMap,
      }),
    ).toBe('serpent://source/lib-1/asset-normal?revision=rev-1');
  });

  it('leaves unmatched relative references untouched (material degrade)', () => {
    expect(
      remapCompanionUrl({
        relativePath: 'missing/tex.png',
        libraryId: 'lib-1',
        companionMap,
      }),
    ).toBeNull();
  });

  it('passes absolute and data URLs through untouched', () => {
    for (const url of [
      'serpent://preview/lib-1/art-9',
      'https://example.com/tex.png',
      'data:image/png;base64,AAAA',
      'file:///tmp/tex.png',
    ]) {
      expect(
        remapCompanionUrl({ relativePath: url, libraryId: 'lib-1', companionMap }),
      ).toBeNull();
    }
  });

  it('matches by basename as a fallback (FBX attribute names)', () => {
    expect(
      remapCompanionUrlByBasename({
        fileName: 'normal.png',
        libraryId: 'lib-1',
        companionMap,
      }),
    ).toBe('serpent://source/lib-1/asset-normal?revision=rev-1');
    // Exact path wins over basename when both exist.
    expect(
      remapCompanionUrlByBasename({
        fileName: 'tex/normal.png',
        libraryId: 'lib-1',
        companionMap,
      }),
    ).toBe('serpent://source/lib-1/asset-normal?revision=rev-1');
  });

  it('never basename-matches absolute URLs', () => {
    expect(
      remapCompanionUrlByBasename({
        fileName: 'serpent://preview/lib-1/asset-albedo',
        libraryId: 'lib-1',
        companionMap,
      }),
    ).toBeNull();
  });

  it('rewrites glTF image and buffer uris only', () => {
    const gltf = {
      images: [
        { uri: 'textures/albedo.png' },
        { uri: 'data:image/png;base64,AAAA' },
        {},
      ],
      buffers: [{ uri: 'mesh.bin' }, { uri: 'https://x/y.bin' }],
      asset: { version: '2.0' },
    };
    const remap = (path: string) =>
      remapCompanionUrl({ relativePath: path, libraryId: 'lib-1', companionMap });
    const rewritten = rewriteGltfUris(gltf, remap);
    expect(rewritten.images?.[0]?.uri).toBe(
      'serpent://source/lib-1/asset-albedo?revision=rev-1',
    );
    expect(rewritten.images?.[1]?.uri).toBe('data:image/png;base64,AAAA');
    expect(rewritten.images?.[2]?.uri).toBeUndefined();
    expect(rewritten.buffers?.[0]?.uri).toBe('mesh.bin'); // unmatched
    expect(rewritten.buffers?.[1]?.uri).toBe('https://x/y.bin');
    expect((rewritten as { asset: unknown }).asset).toEqual({ version: '2.0' });
  });

  it('collects mtllib references in file order', () => {
    const obj = [
      '# comment',
      'mtllib first.mtl',
      'o object',
      'mtllib last.mtl',
      'v 0 0 0',
    ].join('\n');
    expect(collectObjMtllibRefs(obj)).toEqual(['first.mtl', 'last.mtl']);
    expect(collectObjMtllibRefs('v 1 2 3\n')).toEqual([]);
  });

  it('extracts MTL texture paths exactly like MTLLoader option stripping', () => {
    expect(extractMtlTexturePath('albedo.png')).toBe('albedo.png');
    expect(extractMtlTexturePath('-s 1 1 1 albedo.png')).toBe('albedo.png');
    expect(extractMtlTexturePath('-bm 0.5 -o 1 2 3 tex.png')).toBe('tex.png');
    expect(extractMtlTexturePath('-mm 0.5 0.9 tex.png')).toBe('tex.png');
    // File names may contain spaces (MTLLoader joins remaining tokens).
    expect(extractMtlTexturePath('my folder/tex file.png')).toBe(
      'my folder/tex file.png',
    );
    expect(extractMtlTexturePath('-s 1 1 1')).toBeNull();
  });

  it('rewrites MTL texture references, preserving options', () => {
    const mtl = [
      'newmtl robot',
      'map_Kd -s 1 1 1 textures/albedo.png',
      'map_Ks props/robot/tex/normal.png',
      'bump bump.png',
      'map_d alpha.png',
      'Kd 0.8 0.8 0.8',
    ].join('\n');
    const remap = (path: string) =>
      remapCompanionUrl({ relativePath: path, libraryId: 'lib-1', companionMap });
    const rewritten = rewriteMtlTextureRefs(mtl, remap);
    expect(rewritten).toContain(
      'map_Kd -s 1 1 1 serpent://source/lib-1/asset-albedo?revision=rev-1',
    );
    expect(rewritten).toContain(
      'map_Ks serpent://source/lib-1/asset-normal-subdir?revision=rev-1',
    );
    // Unmatched references stay as-is (material degrades).
    expect(rewritten).toContain('bump bump.png');
    expect(rewritten).toContain('map_d alpha.png');
    expect(rewritten).toContain('Kd 0.8 0.8 0.8');
  });
});
