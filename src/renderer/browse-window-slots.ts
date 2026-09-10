/** Serpent-sa65: page math and real-summary merging for virtualized browse. */

import type { AssetSummary, BrowseLayoutEntry } from "../shared/asset-types";

export function browsePageOffset(
  index: number,
  pageSize: number,
): number {
  if (index <= 0 || pageSize <= 0) return 0;
  return Math.floor(index / pageSize) * pageSize;
}

/** Group missing page offsets into runs that can be fetched in one request. */
export function contiguousBrowsePageRuns(
  offsets: readonly number[],
  pageSize: number,
): number[][] {
  const step = Math.max(1, Math.trunc(pageSize));
  const sorted = [...new Set(offsets)].sort((left, right) => left - right);
  const runs: number[][] = [];
  for (const offset of sorted) {
    const previous = runs.at(-1)?.at(-1);
    if (previous === undefined || offset !== previous + step) {
      runs.push([offset]);
    } else {
      runs.at(-1)!.push(offset);
    }
  }
  return runs;
}

/**
 * Page offsets that cover the visible index range plus one page of overscan
 * on each side. The primary (midpoint) page is first so a scrollbar jump
 * paints the destination before neighbours.
 */
export function browsePageOffsetsForRange(input: {
  startIndex: number;
  endIndex: number;
  total: number;
  pageSize: number;
}): number[] {
  const pageSize = Math.max(1, input.pageSize);
  const total = Math.max(0, input.total);
  if (total === 0) return [];
  const lo = Math.max(0, Math.min(input.startIndex, input.endIndex) - pageSize);
  const hi = Math.min(
    total - 1,
    Math.max(input.startIndex, input.endIndex) + pageSize,
  );
  const first = browsePageOffset(lo, pageSize);
  const last = browsePageOffset(hi, pageSize);
  const offsets: number[] = [];
  for (let offset = first; offset <= last; offset += pageSize) {
    offsets.push(offset);
  }
  const primary = browsePageOffset(
    Math.floor((input.startIndex + input.endIndex) / 2),
    pageSize,
  );
  if (!offsets.includes(primary)) return offsets;
  return [primary, ...offsets.filter((offset) => offset !== primary)];
}

/**
 * Merge real summaries only. The compact layout index owns full-scope order
 * and scrollbar geometry; unloaded assets never become fake AssetSummary
 * cards and therefore cannot flash `__pending:` placeholders.
 */
export function mergeLoadedBrowsePage(input: {
  current: readonly AssetSummary[];
  items: readonly AssetSummary[];
  layout: readonly BrowseLayoutEntry[];
}): AssetSummary[] {
  const byId = new Map(input.current.map((asset) => [asset.assetId, asset]));
  for (const asset of input.items) byId.set(asset.assetId, asset);
  const rank = new Map(
    input.layout.map((entry, index) => [entry.assetId, index] as const),
  );
  return [...byId.values()].sort((left, right) => {
    const leftRank = rank.get(left.assetId);
    const rightRank = rank.get(right.assetId);
    if (leftRank === undefined && rightRank === undefined) return 0;
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  });
}

/** First-paint Inspector/card copy from the compact layout index (Serpent-l2at / Serpent-joz6). */
export function assetSummaryFromLayoutEntry(
  entry: BrowseLayoutEntry,
): AssetSummary | undefined {
  const displayName = entry.displayName?.trim();
  if (!displayName) return undefined;
  const relativeFilePath = entry.relativeFilePath?.trim() || displayName;
  return {
    assetId: entry.assetId,
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath,
    displayName,
    currentRevisionId: `layout:${entry.assetId}`,
    byteSize: entry.byteSize ?? 0,
    modifiedAt: entry.modifiedAt ?? new Date(0).toISOString(),
    availability: "available",
    rating: entry.rating ?? 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: entry.previewArtifactId ? "ready" : "pending",
    thumbnailArtifactId: entry.previewArtifactId ?? null,
    mediaType: "other",
    width: entry.width,
    height: entry.height,
    durationMs: null,
  };
}

function layoutEntryFromLoadedAsset(
  asset: Pick<
    AssetSummary,
    | "assetId"
    | "width"
    | "height"
    | "thumbnailArtifactId"
    | "displayName"
    | "relativeFilePath"
    | "byteSize"
    | "modifiedAt"
    | "rating"
  >,
): BrowseLayoutEntry {
  return {
    assetId: asset.assetId,
    width: asset.width,
    height: asset.height,
    previewArtifactId: asset.thumbnailArtifactId,
    displayName: asset.displayName,
    relativeFilePath: asset.relativeFilePath,
    byteSize: asset.byteSize,
    modifiedAt: asset.modifiedAt,
    rating: asset.rating,
  };
}

/**
 * True when the compact geometry index already covers the reported scope.
 * A first-page-sized layout is not complete just because it is non-empty.
 */
export function compactBrowseLayoutIsComplete(
  layoutLength: number,
  total: number,
): boolean {
  return total > 0 && layoutLength >= total;
}

/**
 * Next page to fetch when the compact layout index is still incomplete
 * (Serpent-9cfc8c). Tail-jump pagination assumes full scrollbar geometry;
 * without it, only sequential windows can grow the visible canvas.
 */
export function nextUnfilledBrowsePageOffset(
  filled: ReadonlySet<number>,
  total: number,
  pageSize: number,
): number | null {
  const step = Math.max(1, Math.trunc(pageSize));
  const end = Math.max(0, Math.trunc(total));
  if (end <= 0) return null;
  for (let offset = 0; offset < end; offset += step) {
    if (!filled.has(offset)) return offset;
  }
  return null;
}

/**
 * Canvas source of truth: a stale first-page layout must not hide summaries
 * that pagination already loaded. Full layout (length >= assets) still wins
 * so unloaded slots can paint as compact previews.
 */
export function resolveBrowseCanvasLayout(
  layout: readonly BrowseLayoutEntry[],
  assets: readonly AssetSummary[],
): BrowseLayoutEntry[] {
  if (layout.length === 0) {
    return assets.map(layoutEntryFromLoadedAsset);
  }
  if (assets.length <= layout.length) {
    return layout as BrowseLayoutEntry[];
  }
  const seen = new Set(layout.map((entry) => entry.assetId));
  const extra: BrowseLayoutEntry[] = [];
  for (const asset of assets) {
    if (seen.has(asset.assetId)) continue;
    extra.push(layoutEntryFromLoadedAsset(asset));
  }
  return extra.length === 0 ? (layout as BrowseLayoutEntry[]) : [...layout, ...extra];
}
