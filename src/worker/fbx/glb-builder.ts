import {
  FBX_GLB_GENERATOR_VERSION,
  type FbxConversionStats,
} from '../../shared/fbx-conversion';
import type {
  FbxDescriptor,
  FbxMeshDescriptor,
  FbxTextureDescriptor,
} from './descriptor';

/**
 * glTF 2.0 GLB builder for the ufbx bridge descriptor.
 *
 * The bridge hands back per-corner geometry (positions/normals/UVs), per
 * material-part triangle runs, materials and textures. This module assembles a
 * binary GLB with hand-written glTF JSON:
 *
 *   - one glTF `mesh` per source mesh, one primitive per material part
 *   - one glTF `node` per mesh instance; non-identity instance transforms are
 *     emitted as node.matrix (column-major, matching the bridge output)
 *   - textures embedded as images (PNG/JPEG; others are skipped with a warning)
 *   - units are meters, axes are right-handed Y-up (baked by the bridge)
 *
 * Known MVP limitations (surfaced in `warnings`, not silently dropped):
 *   - texture UV transforms (KHR_texture_transform) are ignored
 *   - only the first UV set is exported; vertex colors are not exported
 */

const IDENTITY_MATRIX = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function isIdentityMatrix(m: number[]): boolean {
  if (m.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    if (Math.abs(m[i]! - IDENTITY_MATRIX[i]!) > 1e-9) return false;
  }
  return true;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export interface ResolvedTexture {
  mimeType: 'image/png' | 'image/jpeg';
  bytes: Buffer;
}

export interface GlbBuildInput {
  descriptor: FbxDescriptor;
  /** [u32 JSON length][JSON][blobs] exactly as returned by the bridge. */
  packed: Buffer;
  /** Descriptor texture index → resolved image bytes. */
  textures: Map<number, ResolvedTexture>;
  /** Size of the source FBX (for stats). */
  sourceBytes: number;
}

export interface GlbBuildOutput {
  glb: Buffer;
  stats: FbxConversionStats;
  /** Texture filenames that could not be embedded. */
  unresolvedTextures: string[];
  warnings: string[];
}

interface GltfAccessor {
  bufferView?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4';
  min?: number[];
  max?: number[];
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode: number;
}

interface GltfJson {
  asset: { version: '2.0'; generator: string };
  scene: number;
  scenes: Array<{ nodes: number[] }>;
  nodes: Array<{ name?: string; mesh?: number; matrix?: number[] }>;
  meshes: Array<{ name?: string; primitives: GltfPrimitive[] }>;
  materials: Array<Record<string, unknown>>;
  textures?: Array<{ source: number }>;
  images?: Array<{ bufferView?: number; mimeType?: string }>;
  buffers: Array<{ byteLength: number }>;
  bufferViews?: Array<{ buffer: number; byteOffset: number; byteLength: number }>;
  accessors?: GltfAccessor[];
}

export function buildGlb(input: GlbBuildInput): GlbBuildOutput {
  const { descriptor, packed, textures, sourceBytes } = input;
  const warnings: string[] = [...descriptor.warnings];
  const unresolvedTextures: string[] = [];
  const gltf: GltfJson = {
    asset: { version: '2.0', generator: FBX_GLB_GENERATOR_VERSION },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    buffers: [{ byteLength: 0 }],
    bufferViews: [],
    accessors: [],
  };

  // -- Decode the bridge output -------------------------------------------
  if (packed.length < 4) throw new Error('Bridge output is too short for its length prefix.');
  const jsonLen = packed.readUInt32LE(0);
  const jsonStart = 4;
  if (jsonLen <= 0 || jsonStart + jsonLen > packed.length) {
    throw new Error('Bridge output has an invalid JSON length prefix.');
  }
  const blobBase = jsonStart + jsonLen;

  /** Offset of the first byte after all bridge geometry blobs. */
  const geometryEnd = (() => {
    let end = 0;
    for (const mesh of descriptor.meshes) {
      end = Math.max(end, mesh.positionOffset + mesh.cornerCount * 12);
      if (mesh.normalOffset !== Number.MAX_SAFE_INTEGER) {
        end = Math.max(end, mesh.normalOffset + mesh.cornerCount * 12);
      }
      if (mesh.uvOffset !== Number.MAX_SAFE_INTEGER) {
        end = Math.max(end, mesh.uvOffset + mesh.cornerCount * 8);
      }
      for (const part of mesh.parts) {
        end = Math.max(end, part.indexOffset + part.triangleCount * 12);
      }
    }
    for (const tex of descriptor.textures) {
      if (tex.embedded) end = Math.max(end, tex.contentOffset + tex.contentSize);
    }
    return end;
  })();
  const binRegion = (byteOffset: number, byteLength: number): number => {
    const bufferViews = gltf.bufferViews!;
    bufferViews.push({ buffer: 0, byteOffset, byteLength });
    return bufferViews.length - 1;
  };

  const accessor = (a: GltfAccessor): number => {
    const accessors = gltf.accessors!;
    accessors.push(a);
    return accessors.length - 1;
  };

  // -- Textures → glTF textures/images --------------------------------------
  // BIN layout: bridge geometry + embedded texture content stays in the bridge
  // region; JS-resolved external images are appended after it (4-aligned) in
  // descriptor texture order.
  gltf.textures = [];
  gltf.images = [];
  const gltfTextureByDescriptorIndex = new Map<number, number>();
  const imageSlots: Array<{ tex: FbxTextureDescriptor; bytes: Buffer; offset: number }> = [];
  {
    let cursor = align4(geometryEnd);
    for (const tex of descriptor.textures) {
      let bytes: Buffer | null = null;
      let mime: 'image/png' | 'image/jpeg' | null = null;
      if (tex.embedded && tex.contentSize > 0) {
        const start = blobBase + tex.contentOffset;
        if (start + tex.contentSize <= packed.length) {
          bytes = packed.subarray(start, start + tex.contentSize);
          mime = detectImageMime(bytes);
        }
      } else {
        const resolved = textures.get(tex.index);
        if (resolved) {
          bytes = resolved.bytes;
          mime = detectImageMime(resolved.bytes);
        }
      }
      if (!bytes || !mime) {
        unresolvedTextures.push(tex.relativeFilename || tex.name);
        warnings.push(
          bytes
            ? `texture format not embeddable in GLB (PNG/JPEG only): ${tex.relativeFilename || tex.name}`
            : `texture not embedded: ${tex.relativeFilename || tex.name}`,
        );
        continue;
      }
      if (tex.embedded) {
        // Stays in the bridge region; no extra BIN bytes needed.
        gltf.textures.push({ source: gltf.images.length });
        gltf.images.push({
          bufferView: binRegion(tex.contentOffset, tex.contentSize),
          mimeType: mime,
        });
      } else {
        imageSlots.push({ tex, bytes, offset: cursor });
        gltf.textures.push({ source: gltf.images.length });
        gltf.images.push({ mimeType: mime });
        cursor += align4(bytes.length);
      }
      gltfTextureByDescriptorIndex.set(tex.index, gltf.textures.length - 1);
    }
  }
  for (const slot of imageSlots) {
    const textureIndex = gltfTextureByDescriptorIndex.get(slot.tex.index)!;
    gltf.images[textureIndex]!.bufferView = binRegion(slot.offset, slot.bytes.length);
  }

  // -- Materials (glTF material index == descriptor material index) ----------
  for (const mat of descriptor.materials) {
    const pbr: Record<string, unknown> = {
      baseColorFactor: mat.baseColor.map(clamp01),
      metallicFactor: clamp01(mat.metallic),
      roughnessFactor: clamp01(mat.roughness),
    };
    const tex = (descriptorIndex: number): number | undefined => {
      if (descriptorIndex < 0) return undefined;
      return gltfTextureByDescriptorIndex.get(descriptorIndex);
    };
    const baseTex = tex(mat.baseColorTexture);
    if (baseTex !== undefined) pbr.baseColorTexture = { index: baseTex };
    const mrTex = tex(mat.metallicRoughnessTexture);
    if (mrTex !== undefined) pbr.metallicRoughnessTexture = { index: mrTex };
    const gltfMat: Record<string, unknown> = { pbrMetallicRoughness: pbr };
    const normalTex = tex(mat.normalTexture);
    if (normalTex !== undefined) {
      gltfMat.normalTexture = { index: normalTex, scale: mat.normalScale || 1 };
    }
    const occlusionTex = tex(mat.occlusionTexture);
    if (occlusionTex !== undefined) {
      gltfMat.occlusionTexture = { index: occlusionTex, strength: 1 };
    }
    const emissive = mat.emissive.map(clamp01);
    if (emissive[0]! > 0 || emissive[1]! > 0 || emissive[2]! > 0) {
      gltfMat.emissiveFactor = emissive;
    }
    const emissiveTex = tex(mat.emissiveTexture);
    if (emissiveTex !== undefined) gltfMat.emissiveTexture = { index: emissiveTex };
    if (mat.alphaMode === 'blend') gltfMat.alphaMode = 'BLEND';
    if (mat.doubleSided) gltfMat.doubleSided = true;
    if (mat.name) gltfMat.name = mat.name;
    for (const limitation of mat.limitations) {
      if (!warnings.includes(limitation)) warnings.push(limitation);
    }
    gltf.materials.push(gltfMat);
  }

  // -- Meshes (attributes/accessors shared by all instances) ------------------
  const gltfMeshByDescriptorIndex = new Map<number, number>();
  for (const mesh of descriptor.meshes) {
    if (mesh.cornerCount === 0) continue;
    const positionRange = computePositionRange(packed, blobBase, mesh);
    const attributes: Record<string, number> = {};
    attributes.POSITION = accessor({
      bufferView: binRegion(mesh.positionOffset, mesh.cornerCount * 12),
      componentType: 5126,
      count: mesh.cornerCount,
      type: 'VEC3',
      min: positionRange.min,
      max: positionRange.max,
    });
    if (mesh.normalOffset !== Number.MAX_SAFE_INTEGER) {
      attributes.NORMAL = accessor({
        bufferView: binRegion(mesh.normalOffset, mesh.cornerCount * 12),
        componentType: 5126,
        count: mesh.cornerCount,
        type: 'VEC3',
      });
    }
    if (mesh.uvOffset !== Number.MAX_SAFE_INTEGER) {
      attributes.TEXCOORD_0 = accessor({
        bufferView: binRegion(mesh.uvOffset, mesh.cornerCount * 8),
        componentType: 5126,
        count: mesh.cornerCount,
        type: 'VEC2',
      });
    }
    const primitives: GltfPrimitive[] = [];
    for (const part of mesh.parts) {
      if (part.triangleCount === 0) continue;
      primitives.push({
        attributes,
        indices: accessor({
          bufferView: binRegion(part.indexOffset, part.triangleCount * 12),
          componentType: 5125,
          count: part.triangleCount * 3,
          type: 'SCALAR',
        }),
        material: part.materialIndex >= 0 ? part.materialIndex : undefined,
        mode: 4,
      });
    }
    if (primitives.length === 0) continue;
    gltf.meshes.push({ name: mesh.name || undefined, primitives });
    gltfMeshByDescriptorIndex.set(mesh.index, gltf.meshes.length - 1);
  }

  // -- Nodes (one per instance) -----------------------------------------------
  for (const instance of descriptor.instances) {
    const meshIndex = gltfMeshByDescriptorIndex.get(instance.meshIndex);
    if (meshIndex === undefined) continue;
    const node: GltfJson['nodes'][number] = {
      name: instance.nodeName || undefined,
      mesh: meshIndex,
    };
    if (!isIdentityMatrix(instance.transform)) {
      node.matrix = instance.transform;
    }
    gltf.nodes.push(node);
  }
  gltf.scenes[0]!.nodes = gltf.nodes.map((_, index) => index);

  // -- BIN chunk assembly -------------------------------------------------------
  const binParts: Buffer[] = [];
  binParts.push(packed.subarray(blobBase, blobBase + geometryEnd));
  let binLength = geometryEnd;
  for (const slot of imageSlots) {
    const pad = align4(binLength) - binLength;
    if (pad > 0) {
      binParts.push(Buffer.alloc(pad));
      binLength += pad;
    }
    if (binLength !== slot.offset) {
      throw new Error(`Image bufferView offset mismatch: ${binLength} != ${slot.offset}`);
    }
    binParts.push(slot.bytes);
    binLength += slot.bytes.length;
  }
  const binChunk = Buffer.concat(binParts);
  gltf.buffers[0]!.byteLength = binChunk.length;

  // GLB container: header + JSON chunk + BIN chunk. The JSON chunk data is
  // the raw glTF JSON padded with spaces (0x20) to 4-byte alignment; the
  // chunk length is the padded length (glTF 2.0 §4.3).
  const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPaddedLength = align4(jsonBytes.length);

  const glb = Buffer.alloc(12 + 8 + jsonPaddedLength + 8 + binChunk.length);
  let offset = 0;
  glb.writeUInt32LE(0x46546c67, offset); // magic "glTF"
  glb.writeUInt32LE(2, offset + 4); // version
  glb.writeUInt32LE(glb.length, offset + 8); // total length
  offset += 12;
  // GLB chunk header is [chunkLength u32][chunkType u32]; writing them in the
  // wrong order makes GLTFLoader reject the file with "JSON content not found"
  // (caught by the real-app E2E, not by the magic-bytes-only unit test).
  glb.writeUInt32LE(jsonPaddedLength, offset); // chunk length
  glb.writeUInt32LE(0x4e4f534a, offset + 4); // chunk type "JSON"
  jsonBytes.copy(glb, offset + 8);
  glb.fill(0x20, offset + 8 + jsonBytes.length, offset + 8 + jsonPaddedLength);
  offset += 8 + jsonPaddedLength;
  glb.writeUInt32LE(binChunk.length, offset); // chunk length
  glb.writeUInt32LE(0x004e4942, offset + 4); // chunk type "BIN\0"
  binChunk.copy(glb, offset + 8);

  let triangles = 0;
  let vertices = 0;
  for (const mesh of descriptor.meshes) {
    for (const part of mesh.parts) triangles += part.triangleCount;
    vertices += mesh.cornerCount;
  }

  const stats: FbxConversionStats = {
    triangles,
    vertices,
    meshes: descriptor.meta.meshCount,
    instances: descriptor.meta.instanceCount,
    materials: descriptor.meta.materialCount,
    textures: descriptor.textures.length,
    // unresolvedTextures is the authoritative list: it covers bridge-reported
    // missing textures (no embedded content) AND externally referenced files
    // that could not be resolved or are not PNG/JPEG.
    missingTextures: unresolvedTextures.length,
    sourceBytes,
    glbBytes: glb.length,
    sourceUnitMeters: descriptor.meta.unitMeters,
  };

  return { glb, stats, unresolvedTextures, warnings };
}

function detectImageMime(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return null;
}

function computePositionRange(
  packed: Buffer,
  blobBase: number,
  mesh: FbxMeshDescriptor,
): { min: number[]; max: number[] } {
  const start = blobBase + mesh.positionOffset;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const count = mesh.cornerCount;
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) {
      const value = packed.readFloatLE(start + i * 12 + c * 4);
      if (value < min[c]!) min[c] = value;
      if (value > max[c]!) max[c] = value;
    }
  }
  if (count === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}
