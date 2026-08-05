/**
 * Companion-texture URL remapping for model previews (spec 3D-12 / §6).
 *
 * three loaders resolve external texture references relative to the model
 * URL. Model sources are `serpent://source/<libraryId>/<assetId>` — a flat
 * asset URL with no directory — so relative references would hit the
 * protocol's 400 malformed-path rejection. Instead the renderer rewrites
 * every external reference through the companion index the Worker built for
 * the model's directory (`model.resolve-companions`): relative path →
 * `serpent://source/<libraryId>/<assetId>?revision=<revisionId>`. The
 * `preview` host serves derived artifacts only; companion assets are served
 * by the `source` host (which validates the revision token).
 *
 * Rewrite targets:
 * - OBJ: `mtllib` lines (the MTL asset itself);
 * - MTL: `map_Kd` / `map_Ks` / `bump` / `map_Bump` / `normal` / `map_d` /
 *   `map_Ka` / `map_refl` / `map_Ke` / `map_Ns` / `map_Disp` / `decal`
 *   texture references;
 * - glTF (.gltf): `images[].uri` (and external `buffers[].uri`);
 * - FBX fallback (FBXLoader): material textures matched by `texture.name`
 *   (the FBX attribute name), exact path or basename.
 *
 * References that are already absolute (serpent://, http(s), data:) pass
 * through untouched; unmatched relative references are left as-is and
 * degrade to an untextured material (3D-12: 解析不到时材质降级并提示).
 *
 * All functions are pure and unit-tested.
 */

import type { ModelCompanionAsset } from '../../shared/model-companions';

/** Build a `serpent://preview/<libraryId>/<artifactId>` artifact URL. */
export function serpentPreviewUrl(libraryId: string, artifactId: string): string {
  return `serpent://preview/${libraryId}/${artifactId}`;
}

/** Build a `serpent://source/<libraryId>/<assetId>?revision=<id>` source URL. */
export function serpentSourceUrl(
  libraryId: string,
  assetId: string,
  revisionId?: string,
): string {
  const base = `serpent://source/${libraryId}/${assetId}`;
  return revisionId ? `${base}?revision=${encodeURIComponent(revisionId)}` : base;
}

/**
 * Normalize a library-relative POSIX path for companion matching: strip
 * leading/interior `./` segments and duplicate slashes. Returns null for
 * absolute paths, `..` traversal, or empty input — those can never match a
 * companion asset.
 */
export function normalizeCompanionPath(relativePath: string): string | null {
  if (typeof relativePath !== 'string' || relativePath.length === 0) return null;
  if (relativePath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(relativePath)) {
    return null;
  }
  const cleaned: string[] = [];
  for (const segment of relativePath.replaceAll('\\', '/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') return null;
    cleaned.push(segment);
  }
  return cleaned.length > 0 ? cleaned.join('/') : null;
}

function isAbsoluteOrDataUrl(url: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)/iu.test(url);
}

/**
 * Remap one relative texture reference through the companion map.
 * Returns the `serpent://source` URL, or null when the reference is
 * absolute (leave untouched) or unmatched (leave as-is → degrade).
 */
export function remapCompanionUrl(input: {
  readonly relativePath: string;
  readonly libraryId: string;
  readonly companionMap: ReadonlyMap<string, ModelCompanionAsset>;
}): string | null {
  const { libraryId, companionMap } = input;
  if (isAbsoluteOrDataUrl(input.relativePath)) return null;
  const normalized = normalizeCompanionPath(input.relativePath);
  if (!normalized) return null;
  const companion = companionMap.get(normalized);
  return companion
    ? serpentSourceUrl(libraryId, companion.assetId, companion.revisionId)
    : null;
}

/**
 * Basename fallback for loaders that only know the file name (FBXLoader sets
 * texture.name to the FBX attribute name, which is often just the basename).
 * Exact path match wins; basename matches first-wins. Absolute/data URLs
 * never match (they already resolve elsewhere).
 */
export function remapCompanionUrlByBasename(input: {
  readonly fileName: string;
  readonly libraryId: string;
  readonly companionMap: ReadonlyMap<string, ModelCompanionAsset>;
}): string | null {
  if (isAbsoluteOrDataUrl(input.fileName)) return null;
  const normalized = normalizeCompanionPath(input.fileName);
  if (!normalized) return null;
  const exact = input.companionMap.get(normalized);
  if (exact) return serpentSourceUrl(input.libraryId, exact.assetId, exact.revisionId);
  const basename = normalized.split('/').pop();
  if (!basename) return null;
  for (const [relativePath, companion] of input.companionMap) {
    if (relativePath.split('/').pop() === basename) {
      return serpentSourceUrl(input.libraryId, companion.assetId, companion.revisionId);
    }
  }
  return null;
}

/** glTF JSON slice used by the rewrite (only `uri` fields are touched). */
export type GltfJsonLike = {
  readonly images?: ReadonlyArray<{ readonly uri?: string }>;
  readonly buffers?: ReadonlyArray<{ readonly uri?: string }>;
};

/**
 * Rewrite `.gltf` JSON so external images/buffers load through
 * `serpent://source` companion URLs. Only `uri` strings are touched;
 * embedded base64/data references and everything else pass through.
 */
export function rewriteGltfUris(
  gltf: GltfJsonLike,
  remap: (relativePath: string) => string | null,
): GltfJsonLike {
  const rewrite = (uri: string | undefined): string | undefined => {
    if (!uri) return uri;
    return remap(uri) ?? uri;
  };
  const images = gltf.images?.map((image) =>
    image.uri === undefined
      ? image
      : { ...image, uri: rewrite(image.uri) },
  );
  const buffers = gltf.buffers?.map((buffer) =>
    buffer.uri === undefined
      ? buffer
      : { ...buffer, uri: rewrite(buffer.uri) },
  );
  if (!images && !buffers) return gltf;
  return {
    ...gltf,
    ...(images ? { images } : {}),
    ...(buffers ? { buffers } : {}),
  };
}

const OBJ_MTLIB_PATTERN = /^mtllib\s+(\S+)/u;

/**
 * Collect `mtllib <file>` references from OBJ text, in file order. The
 * loader-registry resolves the LAST reference (three's OBJLoader material
 * creation uses the last library) through the companion map and fetches its
 * MTL text directly.
 */
export function collectObjMtllibRefs(objText: string): string[] {
  const refs: string[] = [];
  for (const line of objText.split(/\r?\n/u)) {
    const match = OBJ_MTLIB_PATTERN.exec(line);
    if (match && match[1]) refs.push(match[1]);
  }
  return refs;
}

/** MTL texture keywords whose value is a file reference (with optional options). */
export const MTL_TEXTURE_KEYWORDS = [
  'map_Kd',
  'map_Ks',
  'map_Ka',
  'map_Bump',
  'bump',
  'normal',
  'map_d',
  'map_refl',
  'map_Ke',
  'map_Ns',
  'map_Disp',
  'decal',
];

const MTL_TEXTURE_PATTERN = new RegExp(
  `^(${MTL_TEXTURE_KEYWORDS.join('|')})\\s+(.+)$`,
  'gmu',
);

/**
 * Option flags three's MTLLoader strips before treating the remaining tokens
 * as the texture URL (see its `parseTexture` implementation).
 */
const MTL_OPTION_ARITY: Readonly<Record<string, number>> = {
  '-bm': 1,
  '-mm': 2,
  '-s': 3,
  '-o': 3,
};

/**
 * Extract the file reference from the tail of an MTL texture line, mirroring
 * MTLLoader's option handling exactly: `-bm/-mm/-s/-o` groups are removed and
 * everything left (optionally containing spaces) is the path.
 */
export function extractMtlTexturePath(rest: string): string | null {
  const items = rest.trim().split(/\s+/u).filter((token) => token.length > 0);
  for (const [flag, arity] of Object.entries(MTL_OPTION_ARITY)) {
    let pos = items.indexOf(flag);
    while (pos >= 0) {
      if (pos + arity < items.length) items.splice(pos, arity + 1);
      else items.splice(pos);
      pos = items.indexOf(flag);
    }
  }
  const path = items.join(' ').trim();
  return path.length > 0 ? path : null;
}

/**
 * Rewrite texture references in MTL text. Options (e.g. `-s 1 1 1`) are
 * preserved; only the path tail is swapped for its serpent://preview URL.
 */
export function rewriteMtlTextureRefs(
  mtlText: string,
  remap: (relativePath: string) => string | null,
): string {
  return mtlText.replace(MTL_TEXTURE_PATTERN, (_match, keyword: string, rest: string) => {
    const path = extractMtlTexturePath(rest);
    if (!path) return _match;
    const mapped = remap(path);
    if (!mapped) return _match;
    // Preserve options verbatim; swap only the final path occurrence.
    const pathIndex = rest.lastIndexOf(path);
    const prefix = pathIndex > 0 ? rest.slice(0, pathIndex) : '';
    return `${keyword} ${prefix}${mapped}`;
  });
}
