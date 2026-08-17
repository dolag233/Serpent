/**
 * Model statistics (spec 3D-13: 三角面/顶点/材质数/贴图数/文件大小，以加载结果为真源).
 *
 * Counts are computed from the LOADED scene graph — the loaded result is the
 * source of truth, not the file header or the conversion report. Textures and
 * materials are counted by object identity (glTF/GLB share them across
 * meshes), triangles from the index/position attributes.
 *
 * The traversal works on a structural subset of the three scene graph
 * (`SceneTreeLike`), so the whole module is unit-testable without a WebGL
 * context or real three objects.
 */

/** Texture slot names scanned on every material (three mesh-material maps). */
export const MATERIAL_TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'bumpMap',
  'metalnessMap',
  'roughnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'specularMap',
  'envMap',
  'lightMap',
  'displacementMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'specularIntensityMap',
  'specularColorMap',
  'anisotropyMap',
] as const;

export interface SceneTreeLike {
  traverse(callback: (object: SceneObjectLike) => void): void;
}

export interface SceneObjectLike {
  /** Present on every three Object3D (`type: 'Mesh'` etc.); enables structural assignment of real scene objects. */
  readonly type?: string;
  geometry?: { readonly index?: { readonly count: number } | null; readonly attributes?: Record<string, { readonly count: number }> } | null;
  material?: object | readonly object[] | null;
}

export interface TextureLike {
  /** For counting texture edges; absent textures (failed loads) are skipped. */
  readonly image?: { readonly naturalWidth?: number; readonly naturalHeight?: number; readonly width?: number; readonly height?: number } | null;
}

export interface ModelStats {
  triangles: number;
  vertices: number;
  materials: number;
  textures: number;
  /** Largest texture edge in pixels (0 when no texture has an image). */
  maxTextureEdge: number;
}

export function countSceneStats(scene: SceneTreeLike): ModelStats {
  let triangles = 0;
  let vertices = 0;
  const materials = new Set<object>();
  const textures = new Set<TextureLike>();
  let maxTextureEdge = 0;

  scene.traverse((object) => {
    const geometry = object.geometry;
    if (geometry) {
      const index = geometry.index;
      if (index && index.count > 0) {
        triangles += Math.floor(index.count / 3);
      } else {
        const position = geometry.attributes?.position;
        if (position && position.count > 0) {
          triangles += Math.floor(position.count / 3);
        }
      }
      const position = geometry.attributes?.position;
      if (position && position.count > 0) {
        vertices += position.count;
      }
    }
    const material = object.material;
    if (material) {
      for (const single of Array.isArray(material) ? material : [material]) {
        materials.add(single);
        maxTextureEdge = Math.max(
          maxTextureEdge,
          scanMaterialTextures(single, textures),
        );
      }
    }
  });

  return {
    triangles,
    vertices,
    materials: materials.size,
    textures: textures.size,
    maxTextureEdge,
  };
}

function scanMaterialTextures(
  material: object,
  textures: Set<TextureLike>,
): number {
  let maxEdge = 0;
  const slots = material as Record<string, unknown>;
  for (const slot of MATERIAL_TEXTURE_SLOTS) {
    const texture = slots[slot];
    if (texture && typeof texture === 'object' && !textures.has(texture as TextureLike)) {
      textures.add(texture as TextureLike);
      const image = (texture as TextureLike).image;
      if (image) {
        const edge = Math.max(
          image.naturalWidth ?? image.width ?? 0,
          image.naturalHeight ?? image.height ?? 0,
        );
        if (edge > maxEdge) maxEdge = edge;
      }
    }
  }
  return maxEdge;
}

/** Human-readable byte size for the stats overlay (3D-13). */
export function formatByteSize(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes >= 0 ? bytes : 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Locale-aware integer formatting for triangle/vertex counts. */
export function formatCount(count: number, locale: string): string {
  const value = Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
  return value.toLocaleString(locale);
}
