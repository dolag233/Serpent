import type {
  AssetSummary,
  BrowseLayoutEntry,
} from "../../shared/asset-types";

const GEOMETRY_PLACEHOLDER_PREFIX = "__geometry__:";

/** A bounded sparse index; unloaded positions are represented only by their integer index. */
export type VirtualBrowseLayout = {
  total: number;
  /**
   * Changes only when a slot's geometry identity changes. Summary/artifact
   * patches deliberately leave this untouched so the canvas does not redo
   * anchor compensation for every thumbnail-ready event.
   */
  geometryRevision: number;
  /** Stable geometry-only view; summary/artifact patches reuse this Map. */
  geometryEntries: ReadonlyMap<number, BrowseLayoutEntry>;
  /** Stable index-to-asset identity view; artifact/summary patches reuse it. */
  assetIdsByIndex: ReadonlyMap<number, string>;
  entries: ReadonlyMap<number, BrowseLayoutEntry>;
  indexByAssetId: ReadonlyMap<string, number>;
};

export function geometryPlaceholderId(index: number): string {
  return `${GEOMETRY_PLACEHOLDER_PREFIX}${index}`;
}

export function isGeometryPlaceholder(
  entry: Pick<BrowseLayoutEntry, "assetId">,
): boolean {
  return entry.assetId.startsWith(GEOMETRY_PLACEHOLDER_PREFIX);
}

export function geometryPlaceholderIndex(assetId: string): number | undefined {
  if (!assetId.startsWith(GEOMETRY_PLACEHOLDER_PREFIX)) return undefined;
  const index = Number(assetId.slice(GEOMETRY_PLACEHOLDER_PREFIX.length));
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

/** Slot id for the published canvas index: real asset, or a stable placeholder. */
export function virtualLayoutPublishedId(
  layout: Pick<VirtualBrowseLayout, "assetIdsByIndex">,
  index: number,
): string {
  return layout.assetIdsByIndex.get(index) ?? geometryPlaceholderId(index);
}

/**
 * Reorder virtual slots for client shuffle without changing Worker rank.
 * Unloaded slots keep the source rank in their placeholder id so pagination
 * can fetch the pages that actually occupy the viewport.
 */
export function permuteVirtualBrowseLayout(
  layout: VirtualBrowseLayout,
  displayToSource: readonly number[],
): VirtualBrowseLayout {
  if (displayToSource.length !== layout.total) return layout;
  let identity = true;
  for (let display = 0; display < displayToSource.length; display += 1) {
    if (displayToSource[display] !== display) {
      identity = false;
      break;
    }
  }
  if (identity) return layout;

  const sourceToDisplay = new Array<number>(displayToSource.length);
  for (let display = 0; display < displayToSource.length; display += 1) {
    const source = displayToSource[display];
    if (source === undefined) continue;
    sourceToDisplay[source] = display;
  }

  const geometryEntries = new Map<number, BrowseLayoutEntry>();
  for (const [source, entry] of layout.geometryEntries) {
    const display = sourceToDisplay[source];
    if (display === undefined) continue;
    geometryEntries.set(display, entry);
  }

  const entries = new Map<number, BrowseLayoutEntry>();
  const indexByAssetId = new Map<string, number>();
  for (const [source, entry] of layout.entries) {
    const display = sourceToDisplay[source];
    if (display === undefined) continue;
    entries.set(display, entry);
    indexByAssetId.set(entry.assetId, display);
  }

  const assetIdsByIndex = new Map<number, string>();
  for (let display = 0; display < displayToSource.length; display += 1) {
    const source = displayToSource[display]!;
    assetIdsByIndex.set(
      display,
      layout.assetIdsByIndex.get(source) ?? geometryPlaceholderId(source),
    );
  }

  return {
    total: layout.total,
    geometryRevision: layout.geometryRevision,
    geometryEntries,
    assetIdsByIndex,
    entries,
    indexByAssetId,
  };
}

function layoutEntryFromAsset(asset: AssetSummary): BrowseLayoutEntry {
  return {
    assetId: asset.assetId,
    width: asset.width,
    height: asset.height,
    previewArtifactId: asset.thumbnailArtifactId,
    ...(asset.previewKind !== undefined
      ? { previewKind: asset.previewKind }
      : {}),
    ...(asset.previewRevisionId !== undefined
      ? { previewRevisionId: asset.previewRevisionId }
      : {}),
    displayName: asset.displayName,
    relativeFilePath: asset.relativeFilePath,
    byteSize: asset.byteSize,
    modifiedAt: asset.modifiedAt,
    rating: asset.rating,
    // Without this the summary page *overwrites* the index's mediaType with
    // nothing, `virtualSlotAsset` falls back to `other`, and every image grows
    // an extension badge the moment its summary lands (CANVAS-038).
    mediaType: asset.mediaType,
  };
}

function safeIndex(index: number): number {
  return Number.isSafeInteger(index) && index >= 0 ? index : -1;
}

function safeTotal(total: number): number {
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

function mergeLayoutEntries(
  current: VirtualBrowseLayout,
  updates: readonly { index: number; entry: BrowseLayoutEntry }[],
): VirtualBrowseLayout {
  const validUpdates = updates.filter(({ index }) => index >= 0 && index < current.total);
  if (validUpdates.length === 0) return current;
  const entries = new Map(current.entries);
  const indexByAssetId = new Map(current.indexByAssetId);
  let mutableAssetIdsByIndex: Map<number, string> | undefined;
  let mutableGeometryEntries: Map<number, BrowseLayoutEntry> | undefined;
  let geometryRevisionDelta = 0;
  for (const { index, entry } of validUpdates) {
    const previous = entries.get(index);
    const identityChanged = previous?.assetId !== entry.assetId;
    if (previous && identityChanged && indexByAssetId.get(previous.assetId) === index) {
      indexByAssetId.delete(previous.assetId);
    }
    const previousIndex = indexByAssetId.get(entry.assetId);
    if (previousIndex !== undefined && previousIndex !== index) {
      entries.delete(previousIndex);
      indexByAssetId.delete(entry.assetId);
      (mutableAssetIdsByIndex ??= new Map(current.assetIdsByIndex)).delete(previousIndex);
    }
    entries.set(index, entry);
    indexByAssetId.set(entry.assetId, index);
    if (identityChanged) {
      const nextAssetIdsByIndex = mutableAssetIdsByIndex
        ?? (mutableAssetIdsByIndex = new Map(current.assetIdsByIndex));
      nextAssetIdsByIndex.delete(index);
      nextAssetIdsByIndex.set(index, entry.assetId);
    }
    // mediaType decides whether a card renders a resolution line, so it is part
    // of the geometry identity: a media-type-only correction must reflow the
    // caption band instead of leaving the slot one line short (Serpent-b1b0f2).
    const geometryChanged = identityChanged
      || previous?.width !== entry.width
      || previous?.height !== entry.height
      || previous?.mediaType !== entry.mediaType;
    if (geometryChanged) {
      (mutableGeometryEntries ??= new Map(current.geometryEntries)).set(index, {
        assetId: entry.assetId,
        width: entry.width,
        height: entry.height,
        ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
      });
      geometryRevisionDelta += 1;
    }
  }
  return {
    ...current,
    geometryRevision: current.geometryRevision + geometryRevisionDelta,
    geometryEntries: mutableGeometryEntries ?? current.geometryEntries,
    assetIdsByIndex: mutableAssetIdsByIndex ?? current.assetIdsByIndex,
    entries,
    indexByAssetId,
  };
}

/** Live dimension patches (video ffprobe, image header) must bump geometry. */
export function patchVirtualLayoutGeometry(
  current: VirtualBrowseLayout,
  patches: ReadonlyMap<string, { width: number; height: number }>,
): VirtualBrowseLayout {
  if (patches.size === 0) return current;
  const updates: Array<{ index: number; entry: BrowseLayoutEntry }> = [];
  for (const [assetId, size] of patches) {
    const index = current.indexByAssetId.get(assetId);
    if (index === undefined) continue;
    const previous = current.entries.get(index);
    if (!previous) continue;
    if (previous.width === size.width && previous.height === size.height) continue;
    updates.push({
      index,
      entry: { ...previous, width: size.width, height: size.height },
    });
  }
  return mergeLayoutEntries(current, updates);
}

export function createVirtualBrowseLayout(input: {
  total: number;
  firstPage: { items: readonly AssetSummary[]; offset: number };
}): VirtualBrowseLayout {
  const current: VirtualBrowseLayout = {
    total: safeTotal(Math.trunc(input.total)),
    geometryRevision: 0,
    geometryEntries: new Map(),
    assetIdsByIndex: new Map(),
    entries: new Map(),
    indexByAssetId: new Map(),
  };
  return mergeVirtualSummaryPage(current, input.firstPage.offset, input.firstPage.items);
}

/**
 * Build the whole-scope virtual layout from ONE complete compact index.
 *
 * CANVAS-038: the previous design streamed 128-row geometry blocks, so every
 * arrival rewrote heights and identities while the user was scrolling — the
 * scrollbar thumb tracked the loaded subset instead of COUNT, and each revision
 * re-sliced the window. A scope whose index fits in one `layoutOnly` response
 * (capped at BROWSE_SCOPE_MAX_ASSETS) instead commits geometry exactly once, so
 * `geometryRevision` stops moving and no slot identity changes after seeding.
 *
 * A truncated index (scope above the cap) still works: positions beyond the
 * returned prefix stay geometry placeholders and resolve through the summary
 * pages, and because slots are keyed by index that is a prop update, not a
 * remount.
 */
export function createVirtualBrowseLayoutFromIndex(input: {
  total: number;
  entries: readonly BrowseLayoutEntry[];
}): VirtualBrowseLayout {
  const empty: VirtualBrowseLayout = {
    total: Math.max(safeTotal(Math.trunc(input.total)), input.entries.length),
    geometryRevision: 0,
    geometryEntries: new Map(),
    assetIdsByIndex: new Map(),
    entries: new Map(),
    indexByAssetId: new Map(),
  };
  return mergeLayoutEntries(
    empty,
    input.entries.map((entry, index) => ({ index, entry })),
  );
}

/**
 * True when a freshly reported first page is the same ordered scope that the
 * committed index already describes.
 *
 * CANVAS-038: rebuilding the virtual layout from the 100-item first page makes
 * every not-yet-refetched slot fall back to an estimated height, which moved the
 * scrollbar by ~20% on a 1442-asset network library (measured 57999 → 69561 px,
 * placeholders exactly at indices 100+). Deciding by *content* rather than by
 * comparing browse definitions means a refresh is recognised no matter which
 * request-scoped field changed (session id, null-vs-undefined filters, …), while
 * a real navigation to a different scope fails the id check and starts clean.
 */
export function virtualIndexMatchesFirstPage(
  layout: VirtualBrowseLayout | null,
  firstPage: { offset: number; items: readonly Pick<AssetSummary, "assetId">[] },
): boolean {
  if (!layout || layout.total <= 0) return false;
  const offset = Math.max(0, Math.trunc(firstPage.offset));
  if (firstPage.items.length === 0) return false;
  for (let index = 0; index < firstPage.items.length; index += 1) {
    const entry = layout.entries.get(offset + index);
    if (!entry || entry.assetId !== firstPage.items[index]!.assetId) return false;
  }
  return true;
}

/** Patch only summaries that have arrived; all other positions remain implicit. */
export function mergeVirtualSummaryPage(
  current: VirtualBrowseLayout,
  offset: number,
  items: readonly AssetSummary[],
): VirtualBrowseLayout {
  const start = safeIndex(Math.trunc(offset));
  if (start < 0) return current;
  return mergeLayoutEntries(
    current,
    items.map((item, index) => ({
      index: start + index,
      entry: layoutEntryFromAsset(item),
    })),
  );
}

/** Return a transient slot for one position without allocating a full list. */
export function virtualLayoutEntryAt(
  layout: VirtualBrowseLayout,
  index: number,
): BrowseLayoutEntry {
  const stored = layout.entries.get(index);
  if (stored) return stored;
  const geo = layout.geometryEntries.get(index);
  return {
    assetId: virtualLayoutPublishedId(layout, index),
    width: geo?.width ?? null,
    height: geo?.height ?? null,
    ...(geo?.mediaType === undefined ? {} : { mediaType: geo.mediaType }),
  };
}

export function virtualLayoutEntryForAsset(
  layout: VirtualBrowseLayout,
  assetId: string,
): BrowseLayoutEntry | undefined {
  const index = layout.indexByAssetId.get(assetId);
  return index === undefined ? undefined : layout.entries.get(index);
}

/** Materialize only loaded entries, in snapshot order, for legacy pagination helpers. */
export function materializeVirtualLoadedEntries(
  layout: VirtualBrowseLayout,
): BrowseLayoutEntry[] {
  return [...layout.entries.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry);
}

/**
 * Drop the heavy summary fields for one page while retaining any geometry
 * already fetched for its slots. A later viewport request can fetch the page
 * again; the sparse index never has to retain every visited AssetSummary.
 */
export function evictVirtualSummaryPage(
  layout: VirtualBrowseLayout,
  startIndex: number,
  pageSize: number,
): VirtualBrowseLayout {
  const start = Math.max(0, Math.trunc(startIndex));
  const end = Math.min(
    layout.total,
    start + Math.max(1, Math.trunc(pageSize)),
  );
  const entries = new Map(layout.entries);
  const indexByAssetId = new Map(layout.indexByAssetId);
  const assetIdsByIndex = new Map(layout.assetIdsByIndex);
  for (const [index, entry] of layout.entries) {
    if (index < start || index >= end || entry.displayName === undefined) continue;
    const geometry: BrowseLayoutEntry = {
      assetId: entry.assetId,
      width: entry.width,
      height: entry.height,
      ...(entry.previewArtifactId === undefined
        ? {}
        : { previewArtifactId: entry.previewArtifactId }),
      ...(entry.previewKind === undefined
        ? {}
        : { previewKind: entry.previewKind }),
      ...(entry.previewRevisionId === undefined
        ? {}
        : { previewRevisionId: entry.previewRevisionId }),
      // Eviction keeps the slot renderable from the index, so it must keep the
      // caption band inputs too: dropping mediaType would shrink the band and
      // shift every row below it (Serpent-b1b0f2).
      ...(entry.mediaType === undefined ? {} : { mediaType: entry.mediaType }),
    };
    const hasGeometry = geometry.width !== undefined
      || geometry.height !== undefined
      || geometry.previewArtifactId !== undefined;
    if (hasGeometry) {
      entries.set(index, geometry);
    } else {
      entries.delete(index);
      indexByAssetId.delete(entry.assetId);
      assetIdsByIndex.delete(index);
    }
  }
  return { ...layout, entries, indexByAssetId, assetIdsByIndex };
}

/** IDs whose full summary fields are currently resident in the sparse map. */
export function virtualSummaryAssetIds(
  layout: VirtualBrowseLayout,
): Set<string> {
  return new Set(
    [...layout.entries.values()]
      .filter((entry) => entry.displayName !== undefined)
      .map((entry) => entry.assetId),
  );
}

/** Local optimistic deletion; the next reconciliation creates a fresh snapshot. */
export function removeVirtualLayoutEntries(
  layout: VirtualBrowseLayout,
  assetIds: readonly string[],
  removedCount: number,
): VirtualBrowseLayout {
  const removed = new Set(assetIds);
  const entries = new Map(layout.entries);
  const indexByAssetId = new Map(layout.indexByAssetId);
  const assetIdsByIndex = new Map(layout.assetIdsByIndex);
  const geometryEntries = new Map(layout.geometryEntries);
  let geometryRevision = layout.geometryRevision;
  for (const assetId of removed) {
    const index = indexByAssetId.get(assetId);
    if (index === undefined) continue;
    indexByAssetId.delete(assetId);
    entries.delete(index);
    assetIdsByIndex.delete(index);
    if (geometryEntries.delete(index)) geometryRevision += 1;
  }
  return {
    ...layout,
    total: Math.max(0, layout.total - Math.max(0, Math.trunc(removedCount))),
    geometryRevision,
    entries,
    indexByAssetId,
    assetIdsByIndex,
    geometryEntries,
  };
}

