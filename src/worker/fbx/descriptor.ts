/**
 * Types for the packed descriptor produced by the ufbx WASM bridge
 * (scripts/ufbx-bridge.c). The bridge output is `[JSON text][binary blobs]`;
 * all blob offsets in the JSON are relative to the start of the blob section.
 */

/** One material part (subset of mesh faces using one material). */
export interface FbxMeshPartDescriptor {
  materialIndex: number;
  triangleCount: number;
  indexOffset: number;
}

/** One mesh: per-corner attribute blobs + per-material triangle runs. */
export interface FbxMeshDescriptor {
  index: number;
  name: string;
  cornerCount: number;
  positionOffset: number;
  normalOffset: number;
  uvOffset: number;
  totalTriangles: number;
  parts: FbxMeshPartDescriptor[];
}

/** One mesh instance (node referencing a mesh). */
export interface FbxInstanceDescriptor {
  nodeName: string;
  meshIndex: number;
  /** Column-major 4×4 (glTF layout), already in target space (Y-up meters). */
  transform: number[];
}

/** One material (PBR metallic-roughness output). */
export interface FbxMaterialDescriptor {
  name: string;
  shaderType: number;
  baseColor: [number, number, number, number];
  baseColorTexture: number;
  metallic: number;
  roughness: number;
  metallicRoughnessTexture: number;
  hasMetalnessTexture: boolean;
  hasRoughnessTexture: boolean;
  emissive: [number, number, number];
  emissiveTexture: number;
  normalScale: number;
  normalTexture: number;
  occlusionTexture: number;
  opacityTexture: number;
  doubleSided: boolean;
  alphaMode: 'opaque' | 'blend';
  limitations: string[];
}

/** One texture referenced by materials. */
export interface FbxTextureDescriptor {
  index: number;
  name: string;
  relativeFilename: string;
  absoluteFilename: string;
  embedded: boolean;
  contentOffset: number;
  contentSize: number;
}

export interface FbxDescriptorMeta {
  sourceName: string;
  unitMeters: number;
  originalAxisUp: number;
  axes: [number, number, number];
  totalTriangles: number;
  meshCount: number;
  materialCount: number;
  instanceCount: number;
}

/** The full bridge descriptor. */
export interface FbxDescriptor {
  ok: true;
  ufbxVersion: string;
  meta: FbxDescriptorMeta;
  meshes: FbxMeshDescriptor[];
  instances: FbxInstanceDescriptor[];
  materials: FbxMaterialDescriptor[];
  textures: FbxTextureDescriptor[];
  missingTextures: string[];
  warnings: string[];
}

/** Error descriptor returned on parse failure. */
export interface FbxBridgeError {
  ok: false;
  code: 'parse' | 'limits' | 'oom' | 'internal';
  ufbxType?: number;
  message?: string;
}
