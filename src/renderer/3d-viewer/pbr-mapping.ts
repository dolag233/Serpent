import type { ColorRepresentation, Texture } from 'three';

import type { ResolvedTheme } from '../theme';

/**
 * OBJ MTL / FBX-fallback → MeshStandardMaterial mapping (spec 3D-11 / §5).
 *
 * MTL has no metallic-roughness definition (a format limitation, §9) and
 * MTLLoader emits MeshPhongMaterial. `mapPhongToStandard` converts the
 * Phong surface to a metal-rough Standard material:
 *
 * - `map_Kd`  → `map` (albedo)
 * - `map_Ks`  → `metalnessMap` (approximation: specular highlight strength
 *   ≈ metalness; white specular = metal. Kept luminance-neutral: the map
 *   texture is used as-is, three samples its RGB directly)
 * - `bump` / `map_Bump` → `bumpMap`, `normal` → `normalMap`
 * - `map_d`   → `alphaMap` (+ `transparent`)
 * - `Kd` color → `color`; missing → neutral gray (3D-11: "不黑不白")
 * - default `metalness` 0, `roughness` 0.8 so materials read correctly
 *   under IBL without any metal-rough input (§5)
 *
 * FBX fallback path (slice B): when ufbx→GLB conversion fails, the
 * renderer loads the FBX with three's FBXLoader (Blinn-Phong → Phong) and
 * feeds the resulting material properties through this same function;
 * untextured fallbacks use the same neutral defaults.
 *
 * All functions are pure (no side effects, no DOM/WebGL); textures are
 * passed as opaque values and never touched.
 */

/**
 * Minimal Phong material surface, mirroring the properties MTLLoader and
 * FBXLoader produce (MeshPhongMaterial). Slice C adapts loader output to
 * this shape; `Texture` values pass through unchanged.
 */
export type PhongLikeMaterialInput = {
  readonly color?: ColorRepresentation | null;
  /** `map_Kd` — albedo map. */
  readonly map?: Texture | null;
  /** `map_Ks` — specular map, approximated as metalness. */
  readonly specularMap?: Texture | null;
  /** `bump` / `map_Bump`. */
  readonly bumpMap?: Texture | null;
  /** `normal` / `map_Bump` (normal channel). */
  readonly normalMap?: Texture | null;
  /** `map_d`. */
  readonly alphaMap?: Texture | null;
  readonly transparent?: boolean | null;
  /** `d` / `Tr`. */
  readonly opacity?: number | null;
  readonly emissive?: ColorRepresentation | null;
  readonly emissiveMap?: Texture | null;
};

/** Standard material parameter subset the viewer applies after mapping. */
export type StandardMaterialParams = {
  readonly color: ColorRepresentation;
  readonly map: Texture | null;
  readonly normalMap: Texture | null;
  readonly bumpMap: Texture | null;
  readonly metalnessMap: Texture | null;
  readonly alphaMap: Texture | null;
  readonly emissive: ColorRepresentation;
  readonly emissiveMap: Texture | null;
  readonly metalness: number;
  readonly roughness: number;
  readonly transparent: boolean;
  readonly opacity: number;
};

/** Neutral gray for materials with no color/MTL (visible under IBL, not pure black/white). */
export const DEFAULT_MTL_COLOR: ColorRepresentation = 0x9aa0a8;

/** Metal-rough defaults for materials without any PBR input (§5). */
export const DEFAULT_METALNESS = 0;
export const DEFAULT_ROUGHNESS = 0.8;

const DEFAULT_EMISSIVE: ColorRepresentation = 0x000000;

export function mapPhongToStandard(
  input: PhongLikeMaterialInput,
): StandardMaterialParams {
  const opacity = clampUnit(input.opacity ?? 1);
  return {
    color: input.color ?? DEFAULT_MTL_COLOR,
    map: input.map ?? null,
    normalMap: input.normalMap ?? null,
    bumpMap: input.bumpMap ?? null,
    metalnessMap: input.specularMap ?? null,
    alphaMap: input.alphaMap ?? null,
    emissive: input.emissive ?? DEFAULT_EMISSIVE,
    emissiveMap: input.emissiveMap ?? null,
    metalness: DEFAULT_METALNESS,
    roughness: DEFAULT_ROUGHNESS,
    transparent: input.transparent ?? opacity < 1,
    opacity,
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Default STL material (spec §5: "默认中性 PBR 材质（与主题区分度良好的灰/蓝灰）").
 *
 * Gray-blue tinted so the model reads against both theme backgrounds, with
 * a per-theme value so contrast stays comfortable in light and dark mode.
 * STL has no material/color data at all, so this is the only input.
 */
export const STL_DEFAULT_COLORS: Readonly<Record<ResolvedTheme, number>> = {
  light: 0x5f6d7e,
  dark: 0x9aa9bb,
};

export function stlDefaultMaterial(
  themeMode: ResolvedTheme,
): StandardMaterialParams {
  return {
    color: STL_DEFAULT_COLORS[themeMode],
    map: null,
    normalMap: null,
    bumpMap: null,
    metalnessMap: null,
    alphaMap: null,
    emissive: DEFAULT_EMISSIVE,
    emissiveMap: null,
    metalness: DEFAULT_METALNESS,
    roughness: DEFAULT_ROUGHNESS,
    transparent: false,
    opacity: 1,
  };
}
