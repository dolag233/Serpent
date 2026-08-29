import type {
  AssetSummary,
  BrowseGeometryBlock,
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
  };
}

function layoutEntryFromGeometry(
  entry: BrowseGeometryBlock["entries"][number],
): BrowseLayoutEntry {
  return {
    assetId: entry.assetId,
    width: entry.width,
    height: entry.height,
    ...(entry.previewArtifactId !== undefined
      ? { previewArtifactId: entry.previewArtifactId }
      : {}),
    ...(entry.previewKind !== undefined
      ? { previewKind: entry.previewKind }
      : {}),
    ...(entry.previewRevisionId !== undefined
      ? { previewRevisionId: entry.previewRevisionId }
      : {}),
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
    const geometryChanged = identityChanged
      || previous?.width !== entry.width
      || previous?.height !== entry.height;
    if (geometryChanged) {
      (mutableGeometryEntries ??= new Map(current.geometryEntries)).set(index, {
        assetId: entry.assetId,
        width: entry.width,
        height: entry.height,
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

/** Patch only one geometry block; summary-only fields already in the sparse map survive. */
export function mergeVirtualGeometryBlock(
  current: VirtualBrowseLayout,
  block: BrowseGeometryBlock,
): VirtualBrowseLayout {
  const updates = [] as Array<{ index: number; entry: BrowseLayoutEntry }>;
  for (const entry of block.entries) {
    const index = safeIndex(entry.index);
    if (index < 0 || index >= current.total) continue;
    const previous = current.entries.get(index);
    const geometry = layoutEntryFromGeometry(entry);
    updates.push({
      index,
      entry: previous && !isGeometryPlaceholder(previous)
        ? { ...previous, ...geometry }
        : geometry,
    });
  }
  return mergeLayoutEntries(current, updates);
}

/** Return a transient slot for one position without allocating a full list. */
export function virtualLayoutEntryAt(
  layout: VirtualBrowseLayout,
  index: number,
): BrowseLayoutEntry {
  return layout.entries.get(index) ?? {
    assetId: geometryPlaceholderId(index),
    width: null,
    height: null,
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

/** Evict geometry-only entries when their bounded block leaves the LRU cache. */
export function evictVirtualGeometryBlock(
  layout: VirtualBrowseLayout,
  startIndex: number,
  blockSize: number,
): VirtualBrowseLayout {
  const endIndex = startIndex + Math.max(1, Math.trunc(blockSize));
  const entries = new Map(layout.entries);
  const indexByAssetId = new Map(layout.indexByAssetId);
  const assetIdsByIndex = new Map(layout.assetIdsByIndex);
  const geometryEntries = new Map(layout.geometryEntries);
  let geometryRevision = layout.geometryRevision;
  for (const [index, entry] of layout.entries) {
    if (index < startIndex || index >= endIndex || entry.displayName) continue;
    entries.delete(index);
    indexByAssetId.delete(entry.assetId);
    assetIdsByIndex.delete(index);
    if (geometryEntries.delete(index)) geometryRevision += 1;
  }
  return {
    ...layout,
    entries,
    indexByAssetId,
    assetIdsByIndex,
    geometryEntries,
    geometryRevision,
  };
}
