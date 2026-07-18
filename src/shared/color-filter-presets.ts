/** Named color buckets for discovery filtering (dominant_hue degrees). */

export type ColorPresetId =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "pink";

export type HueSpan = { min: number; max: number };

export type ColorPreset = {
  id: ColorPresetId;
  /** CSS swatch for the dimension popover. */
  swatch: string;
  /** Half-open hue intervals in [0, 360). Red wraps across 0. */
  hues: HueSpan[];
};

export const COLOR_PRESETS: readonly ColorPreset[] = [
  {
    id: "red",
    swatch: "#e11d48",
    hues: [
      { min: 345, max: 360 },
      { min: 0, max: 15 },
    ],
  },
  { id: "orange", swatch: "#f97316", hues: [{ min: 15, max: 45 }] },
  { id: "yellow", swatch: "#eab308", hues: [{ min: 45, max: 75 }] },
  { id: "green", swatch: "#22c55e", hues: [{ min: 75, max: 165 }] },
  { id: "cyan", swatch: "#06b6d4", hues: [{ min: 165, max: 195 }] },
  { id: "blue", swatch: "#3b82f6", hues: [{ min: 195, max: 255 }] },
  { id: "purple", swatch: "#a855f7", hues: [{ min: 255, max: 295 }] },
  { id: "pink", swatch: "#ec4899", hues: [{ min: 295, max: 345 }] },
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

/** Build SQL fragment + params matching any selected color bucket on a hue column. */
export function colorFilterSql(
  hueColumn: string,
  ids: readonly ColorPresetId[],
  exclude: boolean,
): { sql: string; params: number[] } | null {
  const spans: HueSpan[] = [];
  for (const id of ids) {
    const preset = colorPresetById(id);
    if (preset) spans.push(...preset.hues);
  }
  if (spans.length === 0) return null;

  const clauses = spans.map(() => `(${hueColumn} >= ? AND ${hueColumn} < ?)`);
  const matchAny = `(${clauses.join(" OR ")})`;
  const params = spans.flatMap((span) => [span.min, span.max]);

  if (exclude) {
    return {
      sql: `(${hueColumn} IS NULL OR NOT ${matchAny})`,
      params,
    };
  }
  return {
    sql: `(${hueColumn} IS NOT NULL AND ${matchAny})`,
    params,
  };
}
