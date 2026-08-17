// REQ-SELECT-004: UE-style multi-select Inspector editing.
// Pure decision helpers — App/Inspector stay thin routing layers.

export type ScalarFieldState<T> =
  | { kind: "uniform"; value: T }
  | { kind: "mixed" };

export type MultiEditTag = {
  id: string;
  name: string;
  source: "user" | "ai";
};

export type InspectorMultiEditModel = {
  selectionCount: number;
  description: ScalarFieldState<string>;
  rating: ScalarFieldState<number>;
  favorite: ScalarFieldState<boolean>;
  sourceUrl: ScalarFieldState<string>;
  author: ScalarFieldState<string>;
  tags: MultiEditTag[];
};

/**
 * Resolve a scalar field across a multi-selection.
 * Empty input → null (caller should not enter multi-edit UI).
 * All equal (including all empty/null-normalized) → uniform.
 * Any disagreement → mixed (control disabled, show “多个值”).
 */
export function resolveScalarField<T>(
  values: readonly T[],
  equals: (a: T, b: T) => boolean = Object.is,
): ScalarFieldState<T> | null {
  if (values.length === 0) return null;
  const first = values[0]!;
  for (let i = 1; i < values.length; i += 1) {
    if (!equals(values[i]!, first)) return { kind: "mixed" };
  }
  return { kind: "uniform", value: first };
}

/**
 * Intersection of tags present on every selected asset (by tag id).
 * source is "user" only when every asset carries that id as a user tag
 * (so the remove control stays available for truly shared human tags).
 */
export function intersectAssetTags(
  tagLists: readonly (readonly MultiEditTag[])[],
): MultiEditTag[] {
  if (tagLists.length === 0) return [];
  const [first, ...rest] = tagLists;
  if (!first) return [];

  const commonIds = first
    .map((tag) => tag.id)
    .filter((id) => rest.every((list) => list.some((tag) => tag.id === id)));

  // Preserve first-list order; de-dupe ids that appear twice on one asset.
  const seen = new Set<string>();
  const result: MultiEditTag[] = [];
  for (const id of commonIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const samples = tagLists.map(
      (list) => list.find((tag) => tag.id === id)!,
    );
    const allUser = samples.every((tag) => tag.source === "user");
    result.push({
      id,
      name: samples[0]!.name,
      source: allUser ? "user" : "ai",
    });
  }
  return result;
}

export type MultiEditMetadataSlice = {
  description: string | null;
  rating: number;
  favorite: boolean;
  sourcePageUrl: string | null;
  author: string | null;
  tags: MultiEditTag[];
};

/**
 * Build the Inspector multi-edit model from fully loaded per-asset slices.
 * Caller must pass one slice per selected asset (same length as selection).
 */
export function buildInspectorMultiEdit(
  slices: readonly MultiEditMetadataSlice[],
): InspectorMultiEditModel | null {
  if (slices.length < 2) return null;

  const description = resolveScalarField(
    slices.map((slice) => slice.description ?? ""),
  );
  const rating = resolveScalarField(slices.map((slice) => slice.rating));
  const favorite = resolveScalarField(slices.map((slice) => slice.favorite));
  const sourceUrl = resolveScalarField(
    slices.map((slice) => slice.sourcePageUrl ?? ""),
  );
  const author = resolveScalarField(
    slices.map((slice) => slice.author ?? ""),
  );
  if (!description || !rating || !favorite || !sourceUrl || !author) {
    return null;
  }

  return {
    selectionCount: slices.length,
    description,
    rating,
    favorite,
    sourceUrl,
    author,
    tags: intersectAssetTags(slices.map((slice) => slice.tags)),
  };
}

export function isEditableScalar<T>(
  state: ScalarFieldState<T> | null | undefined,
): state is { kind: "uniform"; value: T } {
  return state?.kind === "uniform";
}

/** Map cached metadata + parsed palette into a multi-edit slice. */
export function toMultiEditSlice(input: {
  description: string | null;
  rating: number;
  favorite: boolean;
  sourcePageUrl: string | null;
  author: string | null;
  tags?: readonly { id: string; name: string; source: "user" | "ai" }[];
}): MultiEditMetadataSlice {
  return {
    description: input.description,
    rating: input.rating,
    favorite: input.favorite,
    sourcePageUrl: input.sourcePageUrl,
    author: input.author,
    tags: (input.tags ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      source: tag.source,
    })),
  };
}

/**
 * Rebuild the multi-edit model from a per-asset metadata cache.
 * Returns null when selection size &lt; 2 or any id is still missing from cache.
 */
export function rebuildMultiEditFromCache(
  assetIds: readonly string[],
  cache: ReadonlyMap<
    string,
    {
      description: string | null;
      rating: number;
      favorite: boolean;
      sourcePageUrl: string | null;
      author: string | null;
      tags?: readonly { id: string; name: string; source: "user" | "ai" }[];
    }
  >,
): InspectorMultiEditModel | null {
  if (assetIds.length < 2) return null;
  const slices: MultiEditMetadataSlice[] = [];
  for (const assetId of assetIds) {
    const metadata = cache.get(assetId);
    if (!metadata) return null;
    slices.push(toMultiEditSlice(metadata));
  }
  return buildInspectorMultiEdit(slices);
}

/** Editor field values derived from a multi-edit model (mixed → empty/0/false). */
export function editorFieldsFromMultiEdit(model: InspectorMultiEditModel): {
  description: string;
  rating: number;
  favorite: boolean;
  sourceUrl: string;
  author: string;
} {
  return {
    description:
      model.description.kind === "uniform" ? model.description.value : "",
    rating: model.rating.kind === "uniform" ? model.rating.value : 0,
    favorite: model.favorite.kind === "uniform" ? model.favorite.value : false,
    sourceUrl: model.sourceUrl.kind === "uniform" ? model.sourceUrl.value : "",
    author: model.author.kind === "uniform" ? model.author.value : "",
  };
}

/**
 * Primary asset first, then other selected assets, capped for the stacked
 * Inspector hero preview (back layers → front = last drawn / highest z).
 */
export function pickInspectorStackAssets<T extends { assetId: string }>(
  primary: T,
  selected: readonly T[],
  maxVisible = 3,
): T[] {
  if (maxVisible < 1) return [];
  const others = selected.filter((asset) => asset.assetId !== primary.assetId);
  return [primary, ...others].slice(0, maxVisible);
}

/** Fit the primary asset's natural size into the Inspector stack max box. */
export function fitInspectorStackFrame(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  if (
    naturalWidth <= 0 ||
    naturalHeight <= 0 ||
    maxWidth <= 0 ||
    maxHeight <= 0
  ) {
    return { width: Math.min(160, maxWidth || 160), height: 160 };
  }
  const scale = Math.min(
    maxWidth / naturalWidth,
    maxHeight / naturalHeight,
    1,
  );
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}
