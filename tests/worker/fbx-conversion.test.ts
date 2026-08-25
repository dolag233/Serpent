import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { convertFbxBuffer } from '../../src/worker/fbx/converter';
import { buildGlb } from '../../src/worker/fbx/glb-builder';
import type { FbxDescriptor } from '../../src/worker/fbx/descriptor';
import { handleFbxConvertCommand } from '../../src/worker/fbx/convert-command';
import { resetSerpentUfbxModuleForTest } from '../../src/worker/fbx/wasm-loader';
import {
  buildAsciiFbx,
  ONE_PX_RED_PNG,
} from '../fixtures/fbx/ascii-fbx';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const CUBE_FBX = path.join(TEST_DIR, '..', 'fixtures', 'fbx', 'blender_272_cube_7400_binary.fbx');
const SUZANNE_FBX = path.join(
  TEST_DIR,
  '..',
  'fixtures',
  'fbx',
  'blender_282_suzanne_7400_binary.fbx',
);

const roots: string[] = [];
const services: LibraryService[] = [];

function newService(...args: ConstructorParameters<typeof LibraryService>): LibraryService {
  const service = new LibraryService(...args);
  services.push(service);
  return service;
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-fbx-'));
  roots.push(root);
  return root;
}

function importAsset(service: LibraryService, libraryId: string, sourcePath: string): string {
  const result = service.prepareOrExecuteImport({
    libraryId,
    sourceKind: 'files',
    sourcePaths: [sourcePath],
  });
  if ('importId' in result) throw new Error('Unexpected import conflict.');
  return result.assets[0]!.assetId;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
}, 120_000);

/* ------------------------------------------------------------------ */
/* GLB structural helpers                                              */
/* ------------------------------------------------------------------ */

interface GltfAccessorJson {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

interface GltfPrimitiveJson {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode: number;
}

interface GltfMeshJson {
  name?: string;
  primitives: GltfPrimitiveJson[];
}

interface GltfNodeJson {
  name?: string;
  mesh?: number;
  matrix?: number[];
}

interface GltfMaterialJson {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: { index: number };
    metallicRoughnessTexture?: { index: number };
  };
  alphaMode?: string;
  doubleSided?: boolean;
}

interface GltfDoc {
  asset: { version: string; generator?: string };
  scenes: Array<{ nodes: number[] }>;
  nodes: GltfNodeJson[];
  meshes: GltfMeshJson[];
  materials: GltfMaterialJson[];
  textures?: Array<{ source: number }>;
  images?: Array<{ bufferView?: number; mimeType?: string }>;
  buffers: Array<{ byteLength: number }>;
  bufferViews: Array<{ buffer: number; byteOffset: number; byteLength: number }>;
  accessors: GltfAccessorJson[];
}

interface ParsedGlb {
  json: GltfDoc;
  bin: Buffer;
}

function parseGlb(glb: Buffer): ParsedGlb {
  expect(glb.length).toBeGreaterThan(20);
  expect(glb.subarray(0, 4).toString('utf8')).toBe('glTF');
  expect(glb.readUInt32LE(4)).toBe(2);
  expect(glb.readUInt32LE(8)).toBe(glb.length);
  // GLB chunk header order is [chunkLength][chunkType "JSON"]; the old
  // swapped order passed the magic-bytes checks but made GLTFLoader reject
  // the file ("JSON content not found") — caught by the real-app E2E.
  const jsonChunkLength = glb.readUInt32LE(12);
  expect(glb.readUInt32LE(16)).toBe(0x4e4f534a); // "JSON"
  const json = JSON.parse(glb.subarray(20, 20 + jsonChunkLength).toString('utf8'));
  const binChunkStart = 20 + jsonChunkLength;
  const binChunkLength = glb.readUInt32LE(binChunkStart);
  expect(glb.readUInt32LE(binChunkStart + 4)).toBe(0x004e4942); // "BIN\0"
  const bin = glb.subarray(binChunkStart + 8, binChunkStart + 8 + binChunkLength);
  expect(binChunkStart + 8 + binChunkLength).toBe(glb.length);
  return { json, bin };
}

function readAccessorFloat(
  glb: ParsedGlb,
  accessorIndex: number,
  componentCount: number,
): number[][] {
  const accessor = glb.json.accessors[accessorIndex]!;
  const view = glb.json.bufferViews[accessor.bufferView ?? 0]!;
  const start = view.byteOffset + (accessor.byteOffset ?? 0);
  const values: number[][] = [];
  for (let i = 0; i < accessor.count; i++) {
    const row: number[] = [];
    for (let c = 0; c < componentCount; c++) {
      row.push(glb.bin.readFloatLE(start + i * componentCount * 4 + c * 4));
    }
    values.push(row);
  }
  return values;
}

function readAccessorUint(glb: ParsedGlb, accessorIndex: number): number[] {
  const accessor = glb.json.accessors[accessorIndex]!;
  const view = glb.json.bufferViews[accessor.bufferView ?? 0]!;
  const start = view.byteOffset + (accessor.byteOffset ?? 0);
  const values: number[] = [];
  for (let i = 0; i < accessor.count; i++) {
    values.push(glb.bin.readUInt32LE(start + i * 4));
  }
  return values;
}

function firstPrimitive(glb: ParsedGlb): { mesh: GltfMeshJson; node: GltfNodeJson } {
  const node = glb.json.nodes[0]!;
  const mesh = glb.json.meshes[node.mesh ?? 0]!;
  return { mesh, node };
}

function materialByName(glb: ParsedGlb, name: string): GltfMaterialJson | undefined {
  return glb.json.materials.find((m) => m.name === name);
}

/* ------------------------------------------------------------------ */
/* Converter (pure pipeline)                                           */
/* ------------------------------------------------------------------ */

describe('fbx converter — binary Blender fixtures', () => {
  it('converts the Blender 2.72 cube to a valid GLB', async () => {
    const result = await convertFbxBuffer(readFileSync(CUBE_FBX), {
      sourcePath: path.join(temporaryRoot(), 'cube.fbx'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { glb, stats } = result.output;
    expect(glb.subarray(0, 4).toString('utf8')).toBe('glTF');
    const parsed = parseGlb(glb);
    expect(parsed.json.asset.version).toBe('2.0');
    expect(parsed.json.scenes[0]?.nodes).toHaveLength(1);

    const { mesh, node } = firstPrimitive(parsed);
    expect(node.mesh).toBe(0);
    expect(mesh.primitives).toHaveLength(1);
    const primitive = mesh.primitives[0]!;
    const posAccessor = parsed.json.accessors[primitive.attributes.POSITION ?? 0]!;
    const idxAccessor = parsed.json.accessors[primitive.indices ?? 0]!;
    // Cube: 24 corners, 12 triangles.
    expect(posAccessor.count).toBe(24);
    expect(posAccessor.min).toEqual([-1, -1, -1]);
    expect(posAccessor.max).toEqual([1, 1, 1]);
    expect(idxAccessor.count).toBe(36);

    const indices = readAccessorUint(parsed, primitive.indices ?? 0);
    expect(new Set(indices).size).toBe(24);
    for (const index of indices) expect(index).toBeLessThan(24);

    const positions = readAccessorFloat(parsed, primitive.attributes.POSITION ?? 0, 3);
    for (const [x, y, z] of positions) {
      expect(Math.abs(x ?? 0)).toBeLessThanOrEqual(1.001);
      expect(Math.abs(y ?? 0)).toBeLessThanOrEqual(1.001);
      expect(Math.abs(z ?? 0)).toBeLessThanOrEqual(1.001);
    }
    // Normals exist for every corner.
    expect(parsed.json.accessors[primitive.attributes.NORMAL ?? -1]?.count).toBe(24);

    expect(stats.triangles).toBe(12);
    expect(stats.vertices).toBe(24);
    expect(stats.meshes).toBe(1);
    expect(stats.sourceUnitMeters).toBe(1);
    expect(stats.glbBytes).toBe(glb.length);
    expect(stats.sourceBytes).toBe(readFileSync(CUBE_FBX).length);
  });

  it('converts the Blender 2.82 suzanne (968 triangles)', async () => {
    const result = await convertFbxBuffer(readFileSync(SUZANNE_FBX), {
      sourcePath: path.join(temporaryRoot(), 'suzanne.fbx'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.stats.triangles).toBe(968);
    const parsed = parseGlb(result.output.glb);
    const { mesh } = firstPrimitive(parsed);
    expect(parsed.json.accessors[mesh.primitives[0]?.indices ?? -1]?.count).toBe(968 * 3);
  });
});

describe('fbx converter — hand-written ASCII fixture', () => {
  it('converts geometry, material color and per-corner attributes', async () => {
    const source = buildAsciiFbx({ translation: [1, 2, 3] });
    const result = await convertFbxBuffer(source, {
      sourcePath: path.join(temporaryRoot(), 'ascii.fbx'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { glb, stats } = result.output;
    const parsed = parseGlb(glb);

    expect(stats.triangles).toBe(3); // 1 triangle + 1 quad
    expect(stats.vertices).toBe(7); // 3 corners + 4 corners
    expect(stats.materials).toBe(1);

    const { mesh, node } = firstPrimitive(parsed);
    const primitive = mesh.primitives[0]!;
    const pos = readAccessorFloat(parsed, primitive.attributes.POSITION ?? 0, 3);
    // Corner 0 is shared by both faces and must appear once in the corner
    // arrays (positions are per-corner in the fixture).
    expect(pos).toHaveLength(7);
    const texCoordAccessor = parsed.json.accessors?.[primitive.attributes.TEXCOORD_0 ?? -1];
    expect(texCoordAccessor?.count).toBe(7);
    const indices = readAccessorUint(parsed, primitive.indices ?? 0);
    expect(indices).toHaveLength(9);
    for (const index of indices) expect(index).toBeLessThan(7);

    // Lambert material with diffuse color → glTF base color factor.
    const material = materialByName(parsed, 'Mat');
    expect(material).toBeDefined();
    expect(material?.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3)).toEqual([
      expect.closeTo(0.8, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.2, 5),
    ]);

    // Translation (1,2,3) is preserved as a node matrix.
    expect(node.matrix).toEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      1, 2, 3, 1,
    ]);
  });

  it('embeds an embedded PNG texture and maps it to baseColorTexture', async () => {
    const source = buildAsciiFbx({
      texture: { relativeFilename: 'embedded.png', embeddedBytes: ONE_PX_RED_PNG },
    });
    const result = await convertFbxBuffer(source, {
      sourcePath: path.join(temporaryRoot(), 'textured.fbx'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { glb, stats } = result.output;
    const parsed = parseGlb(glb);
    expect(stats.missingTextures).toBe(0);
    expect(result.output.missingTextures).toEqual([]);

    const material = materialByName(parsed, 'Mat');
    expect(material?.pbrMetallicRoughness?.baseColorTexture?.index).toBe(0);
    expect(parsed.json.textures?.[0]?.source).toBe(0);
    const image = parsed.json.images?.[0];
    expect(image?.mimeType).toBe('image/png');
    const view = parsed.json.bufferViews?.[image?.bufferView ?? -1];
    const embedded = parsed.bin.subarray(view?.byteOffset ?? 0, (view?.byteOffset ?? 0) + (view?.byteLength ?? 0));
    expect(embedded).toEqual(ONE_PX_RED_PNG);
  });

  it('composites separate metalness/roughness maps into metallicRoughnessTexture (Serpent-a5ic)', async () => {
    const { default: sharp } = await import('sharp');
    const metalPng = await sharp(Buffer.from([0]), {
      raw: { width: 1, height: 1, channels: 1 },
    }).png().toBuffer();
    const roughPng = await sharp(Buffer.from([128]), {
      raw: { width: 1, height: 1, channels: 1 },
    }).png().toBuffer();
    // Drive glb-builder directly with a bridge-shaped descriptor carrying
    // separate-file metalness/roughness maps (what the ufbx bridge emits for
    // localized Max/Maya exports). Geometry is omitted; the composite path is
    // independent of mesh content.
    const descriptor: FbxDescriptor = {
      ok: true,
      ufbxVersion: '0.23.0',
      meta: {
        sourceName: 'pbr.fbx',
        unitMeters: 1,
        originalAxisUp: 1,
        axes: [1, 2, 0],
        totalTriangles: 0,
        meshCount: 0,
        materialCount: 1,
        instanceCount: 0,
      },
      meshes: [],
      instances: [],
      warnings: [],
      missingTextures: [],
      materials: [{
        name: 'Mat',
        shaderType: 0,
        baseColor: [0.8, 0.2, 0.2, 1],
        baseColorTexture: -1,
        metallic: 0,
        roughness: 1,
        metallicRoughnessTexture: -1,
        metalnessTexture: 0,
        roughnessTexture: 1,
        hasMetalnessTexture: true,
        hasRoughnessTexture: true,
        emissive: [0, 0, 0],
        emissiveTexture: -1,
        normalScale: 1,
        normalTexture: -1,
        occlusionTexture: -1,
        opacityTexture: -1,
        doubleSided: false,
        alphaMode: 'opaque',
        limitations: [
          'metalness texture without matching roughness map',
          'roughness texture without matching metalness map',
        ],
      }],
      textures: [
        { index: 0, name: 'metal.png', relativeFilename: 'metal.png', absoluteFilename: '', embedded: false, contentOffset: 0, contentSize: 0 },
        { index: 1, name: 'rough.png', relativeFilename: 'rough.png', absoluteFilename: '', embedded: false, contentOffset: 0, contentSize: 0 },
      ],
    };
    const packed = Buffer.from([1, 0, 0, 0, 0x7b]); // jsonLen=1 + '{'
    const built = await buildGlb({
      descriptor,
      packed,
      textures: new Map([
        [0, { mimeType: 'image/png', bytes: metalPng }],
        [1, { mimeType: 'image/png', bytes: roughPng }],
      ]),
      sourceBytes: 4,
    });
    // The matching warnings must be gone once the maps are composited.
    expect(built.warnings.filter((w) => w.includes('matching'))).toEqual([]);

    const parsed = parseGlb(built.glb);
    const material = materialByName(parsed, 'Mat');
    const mrIndex = material?.pbrMetallicRoughness?.metallicRoughnessTexture?.index;
    expect(mrIndex).toBeDefined();
    const image = parsed.json.images?.[mrIndex ?? -1];
    const view = parsed.json.bufferViews?.[image?.bufferView ?? -1];
    const png = parsed.bin.subarray(
      view?.byteOffset ?? 0,
      (view?.byteOffset ?? 0) + (view?.byteLength ?? 0),
    );
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    // glTF metallicRoughness: R=255, G=roughness, B=metalness, A=255.
    expect(data[0]).toBe(255);
    expect(data[1]).toBe(128); // G = roughness source
    expect(data[2]).toBe(0); // B = metalness source
    expect(data[3]).toBe(255);
  });

  it('embeds an external PNG when it sits next to the FBX', async () => {
    const root = temporaryRoot();
    writeFileSync(path.join(root, 'mat.png'), ONE_PX_RED_PNG);
    const source = buildAsciiFbx({
      texture: { relativeFilename: 'mat.png' },
    });
    const fbxPath = path.join(root, 'model.fbx');
    writeFileSync(fbxPath, source);
    const result = await convertFbxBuffer(source, { sourcePath: fbxPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseGlb(result.output.glb);
    expect(result.output.missingTextures).toEqual([]);
    expect(parsed.json.images?.[0]?.mimeType).toBe('image/png');
  });

  it('records a missing external texture and drops the texture reference', async () => {
    const root = temporaryRoot();
    const source = buildAsciiFbx({
      texture: { relativeFilename: 'gone.png' },
    });
    const fbxPath = path.join(root, 'model.fbx');
    writeFileSync(fbxPath, source);
    const result = await convertFbxBuffer(source, { sourcePath: fbxPath });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.missingTextures).toContain('gone.png');
    const parsed = parseGlb(result.output.glb);
    expect(parsed.json.textures).toHaveLength(0);
    const material = materialByName(parsed, 'Mat');
    expect(material?.pbrMetallicRoughness?.baseColorTexture).toBeUndefined();
    // The color factor still survives so the model is not black/white.
    expect(material?.pbrMetallicRoughness?.baseColorFactor?.slice(0, 3)).toEqual([
      expect.closeTo(0.8, 5),
      expect.closeTo(0.2, 5),
      expect.closeTo(0.2, 5),
    ]);
  });

  it('converts Z-up centimetre files to Y-up meters', async () => {
    const source = buildAsciiFbx({ upAxis: 2, unitScaleFactor: 1 }); // Z-up, cm
    const result = await convertFbxBuffer(source, {
      sourcePath: path.join(temporaryRoot(), 'zup.fbx'),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parsed = parseGlb(result.output.glb);
    const { node } = firstPrimitive(parsed);
    // Z-up source → the node matrix must map +Z to +Y. The matrix is
    // column-major, so the image of (0,0,1) is the third column (elements
    // 8..10 of the flat array).
    const m = node.matrix ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const transformed = [m[8]!, m[9]!, m[10]!];
    expect(transformed[0]).toBeCloseTo(0, 5);
    expect(transformed[1]).toBeCloseTo(1, 5);
    expect(transformed[2]).toBeCloseTo(0, 5);
    // Unit conversion bakes into geometry: positions are scaled by 0.01.
    const { mesh } = firstPrimitive(parsed);
    const primitive = mesh.primitives[0]!;
    const pos = readAccessorFloat(parsed, primitive.attributes.POSITION ?? 0, 3);
    for (const [x, y, z] of pos) {
      expect(Math.max(Math.abs(x ?? 0), Math.abs(y ?? 0), Math.abs(z ?? 0))).toBeLessThan(0.1);
    }
  });
});

describe('fbx converter — typed failures', () => {
  it('rejects garbage bytes with FBX_NOT_FBX', async () => {
    const result = await convertFbxBuffer(
      Buffer.from('this is definitely not an fbx file'),
      { sourcePath: path.join(temporaryRoot(), 'bad.fbx') },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.errorCode).toBe('FBX_NOT_FBX');
  });

  it('rejects an empty file with FBX_NOT_FBX', async () => {
    const result = await convertFbxBuffer(Buffer.alloc(0), {
      sourcePath: path.join(temporaryRoot(), 'empty.fbx'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.errorCode).toBe('FBX_NOT_FBX');
  });

  it('rejects oversized sources with FBX_LIMIT_EXCEEDED', async () => {
    const oversized = Buffer.alloc(300 * 1024 * 1024 + 1);
    const result = await convertFbxBuffer(oversized, {
      sourcePath: path.join(temporaryRoot(), 'huge.fbx'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.errorCode).toBe('FBX_LIMIT_EXCEEDED');
  });

  it('rejects scenes over the triangle cap with FBX_LIMIT_EXCEEDED', async () => {
    const source = buildAsciiFbx(); // 3 triangles
    const result = await convertFbxBuffer(source, {
      sourcePath: path.join(temporaryRoot(), 'small.fbx'),
      maxTriangles: 2,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.errorCode).toBe('FBX_LIMIT_EXCEEDED');
  });

  it('reports FBX_NO_MESHES for a mesh-less scene', async () => {
    const source = buildAsciiFbx({ withMesh: false });
    const result = await convertFbxBuffer(source, {
      sourcePath: path.join(temporaryRoot(), 'empty-scene.fbx'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.errorCode).toBe('FBX_NO_MESHES');
  });

  it('reports FBX_WASM_UNAVAILABLE when the ufbx module is missing', async () => {
    const previousDir = process.env['SERPENT_UFBX_DIR'];
    try {
      resetSerpentUfbxModuleForTest();
      process.env['SERPENT_UFBX_DIR'] = path.join(temporaryRoot(), 'no-ufbx');
      const result = await convertFbxBuffer(readFileSync(CUBE_FBX), {
        sourcePath: path.join(temporaryRoot(), 'cube.fbx'),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.errorCode).toBe('FBX_WASM_UNAVAILABLE');
    } finally {
      if (previousDir === undefined) delete process.env['SERPENT_UFBX_DIR'];
      else process.env['SERPENT_UFBX_DIR'] = previousDir;
      resetSerpentUfbxModuleForTest();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Worker command (cache + single-flight + artifacts)                 */
/* ------------------------------------------------------------------ */

describe('fbx worker command — model.convert-fbx', () => {
  it('converts an imported asset to a cached model_glb artifact', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FbxLib', selectedParentPath: root });
    const assetId = importAsset(service, library.libraryId, CUBE_FBX);

    const first = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId,
    });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;
    expect(first.glbArtifactId).toBeTruthy();
    expect(first.glbRelativePath).toMatch(/\.model_glb$/);
    expect(first.stats).toMatchObject({ triangles: 12, meshes: 1 });

    const artifact = service.getCurrentArtifact(
      library.libraryId,
      assetId,
      'model_glb',
    )!;
    expect(artifact).toMatchObject({
      status: 'ready',
      mimeType: 'model/gltf-binary',
      generatorVersion: 'ufbx-wasm-1',
      artifactId: first.glbArtifactId,
    });
    const glb = readFileSync(service.getArtifactAbsolutePath(
      library.libraryId,
      first.glbArtifactId,
    ));
    expect(glb.subarray(0, 4).toString('utf8')).toBe('glTF');
  });

  it('serves the cached artifact without reconverting on repeat calls', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FbxLib2', selectedParentPath: root });
    const assetId = importAsset(service, library.libraryId, CUBE_FBX);

    const first = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId,
    });
    const second = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId,
    });
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    if (first.status !== 'ready' || second.status !== 'ready') return;
    expect(second.glbArtifactId).toBe(first.glbArtifactId);
    // Cached hits carry no stats (they did not run a conversion).
    expect(second.stats).toBeUndefined();
  });

  it('deduplicates concurrent conversions of the same asset (single-flight)', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FbxLib3', selectedParentPath: root });
    const assetId = importAsset(service, library.libraryId, SUZANNE_FBX);

    const [a, b, c] = await Promise.all([
      handleFbxConvertCommand(service, { libraryId: library.libraryId, assetId }),
      handleFbxConvertCommand(service, { libraryId: library.libraryId, assetId }),
      handleFbxConvertCommand(service, { libraryId: library.libraryId, assetId }),
    ]);
    expect(a.status).toBe('ready');
    expect(b.status).toBe('ready');
    expect(c.status).toBe('ready');
    if (a.status !== 'ready' || b.status !== 'ready' || c.status !== 'ready') return;
    expect(b.glbArtifactId).toBe(a.glbArtifactId);
    expect(c.glbArtifactId).toBe(a.glbArtifactId);
  });

  it('invalidates the cache when the source file changes revision', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FbxLib4', selectedParentPath: root });
    const assetId = importAsset(service, library.libraryId, CUBE_FBX);

    const first = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId,
    });
    expect(first.status).toBe('ready');
    if (first.status !== 'ready') return;

    // Touch the source file (append a byte) and refresh: new revision.
    const source = service.resolveAssetPath(library.libraryId, assetId);
    const bytes = readFileSync(source);
    writeFileSync(source, Buffer.concat([bytes, Buffer.from([0])]));
    const refresh = service.refreshManagedAssets(library.libraryId);
    expect(refresh.changedCount).toBeGreaterThan(0);

    const second = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId,
    });
    expect(second.status).toBe('ready');
    if (second.status !== 'ready') return;
    expect(second.glbArtifactId).not.toBe(first.glbArtifactId);

    // The old artifact row is invalidated (new revision owns the kind now).
    const stale = service.getCurrentArtifact(
      library.libraryId,
      assetId,
      'model_glb',
    )!;
    expect(stale.artifactId).toBe(second.glbArtifactId);
  });

  it('returns FBX_SOURCE_NOT_FOUND for an unknown asset', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FbxLib5', selectedParentPath: root });
    const result = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId: 'does-not-exist',
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('FBX_SOURCE_NOT_FOUND');
  });

  it('routes conversion failures as typed error codes', async () => {
    const root = temporaryRoot();
    const service = newService();
    const library = service.createLibrary({ displayName: 'FbxLib6', selectedParentPath: root });
    const badPath = path.join(root, 'broken.fbx');
    writeFileSync(badPath, Buffer.from('garbage bytes, not fbx'));
    const assetId = importAsset(service, library.libraryId, badPath);

    const result = await handleFbxConvertCommand(service, {
      libraryId: library.libraryId,
      assetId,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.errorCode).toBe('FBX_NOT_FBX');
    // No artifact is left behind on failure.
    expect(service.getCurrentArtifact(library.libraryId, assetId, 'model_glb')).toBeNull();
  });
});
