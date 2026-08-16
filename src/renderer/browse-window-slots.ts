/**
 * Serpent-87pd: the browse canvas owns one slot per asset in the current
 * scope so the scrollbar reflects the full COUNT, not the loaded page.
 * Unfetched slots are cheap placeholders; window fetches replace them in
 * place by SQL offset. Renderer never ships these stubs across the bridge.
 */

import type { AssetSummary } from "../shared/asset-types";
import { BROWSE_SCOPE_MAX_ASSETS } from "../shared/browse-scope";

export const PENDING_BROWSE_ASSET_PREFIX = "__pending:";

export function isPendingBrowseAsset(
  asset: Pick<AssetSummary, "assetId">,
): boolean {
  return asset.assetId.startsWith(PENDING_BROWSE_ASSET_PREFIX);
}

export function createPendingBrowseAsset(index: number): AssetSummary {
  const token = `${PENDING_BROWSE_ASSET_PREFIX}${index}`;
  return {
    assetId: token,
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath: `pending/${index}.bin`,
    displayName: "…",
    currentRevisionId: token,
    byteSize: 0,
    modifiedAt: "1970-01-01T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: "pending",
    thumbnailArtifactId: null,
    mediaType: "image",
    width: null,
    height: null,
    durationMs: null,
  };
}

export function browsePageOffset(
  index: number,
  pageSize: number,
): number {
  if (index <= 0 || pageSize <= 0) return 0;
  return Math.floor(index / pageSize) * pageSize;
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

export function mergeBrowseWindow(input: {
  current: readonly AssetSummary[];
  total: number;
  offset: number;
  items: readonly AssetSummary[];
}): AssetSummary[] {
  const length = Math.min(
    BROWSE_SCOPE_MAX_ASSETS,
    Math.max(0, Math.floor(input.total)),
  );
  const slots: AssetSummary[] = new Array(length);
  const previous = input.current.length === length ? input.current : [];
  for (let index = 0; index < length; index += 1) {
    const prior = previous[index];
    slots[index] =
      prior && !isPendingBrowseAsset(prior)
        ? prior
        : createPendingBrowseAsset(index);
  }
  for (let index = 0; index < input.items.length; index += 1) {
    const slotIndex = input.offset + index;
    if (slotIndex >= 0 && slotIndex < length) {
      slots[slotIndex] = input.items[index]!;
    }
  }
  return slots;
}
