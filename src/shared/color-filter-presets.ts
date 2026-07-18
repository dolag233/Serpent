/** Named color buckets for discovery filtering (dominant_hue / lightness). */

export type ColorPresetId =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "pink"
  | "black"
  | "white";

export type HueSpan = { min: number; max: number };

export type ColorPreset =
  | {
      id: Exclude<ColorPresetId, "black" | "white">;
      /** CSS swatch for the dimension popover. */
      swatch: string;
      kind: "hue";
      /** Half-open hue intervals in [0, 360). Red wraps across 0. */
      hues: HueSpan[];
    }
  | {
      id: "black" | "white";
      swatch: string;
      kind: "neutral";
      /** Lightness interval on [0, 1] (dominant_lightness). */
      lightness: { min: number; max: number };
    };

export const COLOR_PRESETS: readonly ColorPreset[] = [
  {
    id: "red",
    swatch: "#e11d48",
    kind: "hue",
    hues: [
      { min: 345, max: 360 },
      { min: 0, max: 15 },
    ],
  },
  { id: "orange", swatch: "#f97316", kind: "hue", hues: [{ min: 15, max: 45 }] },
  { id: "yellow", swatch: "#eab308", kind: "hue", hues: [{ min: 45, max: 75 }] },
  { id: "green", swatch: "#22c55e", kind: "hue", hues: [{ min: 75, max: 165 }] },
  { id: "cyan", swatch: "#06b6d4", kind: "hue", hues: [{ min: 165, max: 195 }] },
  { id: "blue", swatch: "#3b82f6", kind: "hue", hues: [{ min: 195, max: 255 }] },
  { id: "purple", swatch: "#a855f7", kind: "hue", hues: [{ min: 255, max: 295 }] },
  { id: "pink", swatch: "#ec4899", kind: "hue", hues: [{ min: 295, max: 345 }] },
  // Neutrals use lightness (FILTER-023): near-black / near-white cards.
  { id: "black", swatch: "#111111", kind: "neutral", lightness: { min: 0, max: 0.18 } },
  { id: "white", swatch: "#f4f4f5", kind: "neutral", lightness: { min: 0.82, max: 1.01 } },
];

export function colorPresetById(id: string): ColorPreset | undefined {
  return COLOR_PRESETS.find((preset) => preset.id === id);
}

export function parseColorFilterIds(raw: string): ColorPresetId[] {
  const allowed = new Set(COLOR_PRESETS.map((preset) => preset.id));
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is ColorPresetId =>
      allowed.has(value as ColorPresetId),
    );
}

/**
 * Build SQL fragment + params matching any selected color bucket.
 * Hue presets use `hueColumn`; black/white use `lightnessColumn`.
 */
export function colorFilterSql(
  hueColumn: string,
  ids: readonly ColorPresetId[],
  exclude: boolean,
  lightnessColumn = "palette_meta.dominant_lightness",
): { sql: string; params: number[] } | null {
  const hueClauses: string[] = [];
  const hueParams: number[] = [];
  const lightClauses: string[] = [];
  const lightParams: number[] = [];

  for (const id of ids) {
    const preset = colorPresetById(id);
    if (!preset) continue;
    if (preset.kind === "hue") {
      for (const span of preset.hues) {
        hueClauses.push(`(${hueColumn} >= ? AND ${hueColumn} < ?)`);
        hueParams.push(span.min, span.max);
      }
    } else {
      lightClauses.push(
        `(${lightnessColumn} IS NOT NULL AND ${lightnessColumn} >= ? AND ${lightnessColumn} < ?)`,
      );
      lightParams.push(preset.lightness.min, preset.lightness.max);
    }
  }

  if (hueClauses.length === 0 && lightClauses.length === 0) return null;

  const parts: string[] = [];
  if (hueClauses.length > 0) {
    parts.push(`(${hueColumn} IS NOT NULL AND (${hueClauses.join(" OR ")}))`);
  }
  if (lightClauses.length > 0) {
    parts.push(`(${lightClauses.join(" OR ")})`);
  }
  const matchAny = parts.length === 1 ? parts[0]! : `(${parts.join(" OR ")})`;
  const params = [...hueParams, ...lightParams];

  if (exclude) {
    return {
      sql: `(NOT ${matchAny} OR (${hueColumn} IS NULL AND ${lightnessColumn} IS NULL))`,
      params,
    };
  }
  return { sql: matchAny, params };
}
