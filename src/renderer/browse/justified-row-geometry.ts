import type { BrowseLayoutEntry } from "../../shared/asset-types";
import { ASSET_GRID_GAP_PX, aspectRatioForAsset, distributeIntegerRowWidths } from "../asset-grid-layout";
import { resolveCaptionBandSource, type CaptionBandSource } from "../asset-caption-band";

export type JustifiedRowGeometry = Readonly<{
  previewHeight: number;
  bodyHeight: number;
  /** Tallest caption band this row's own cards need (Serpent-b1b0f2). */
  captionBand: number;
  widths: readonly number[];
  offset: number;
}>;

type JustifiedGeometryConfiguration = {
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: CaptionBandSource;
};

export type JustifiedGeometrySnapshot = Readonly<JustifiedGeometryConfiguration & {
  geometryEntries: ReadonlyMap<number, BrowseLayoutEntry>;
  rows: readonly JustifiedRowGeometry[];
}>;

/** Immutable geometry state; its owner controls commit and render rollback. */
export function updateJustifiedGeometrySnapshot(
  input: JustifiedGeometryConfiguration & {
    geometryEntries: ReadonlyMap<number, BrowseLayoutEntry>;
  },
  previous?: JustifiedGeometrySnapshot | null,
): JustifiedGeometrySnapshot {
  const configuration = {
    total: Math.max(0, Math.trunc(input.total)),
    itemsPerRow: Math.max(1, Math.trunc(input.itemsPerRow)),
    availableWidth: Math.max(1, Math.round(input.availableWidth)),
    targetHeight: Math.max(1, Math.round(input.targetHeight)),
    captionBand: input.captionBand,
  };
  const compatible = previous !== undefined && previous !== null
    && previous.total === configuration.total
    && previous.itemsPerRow === configuration.itemsPerRow
    && previous.availableWidth === configuration.availableWidth
    && previous.targetHeight === configuration.targetHeight
    && previous.captionBand === configuration.captionBand;
  if (compatible && previous.geometryEntries === input.geometryEntries) return previous;

  const rows: JustifiedRowGeometry[] = [];
  let offset = 0;
  for (let start = 0; start < configuration.total; start += configuration.itemsPerRow) {
    const rowIndex = rows.length;
    const end = Math.min(configuration.total, start + configuration.itemsPerRow);
    const oldRow = compatible ? previous.rows[rowIndex] : undefined;
    let unchanged = oldRow !== undefined;
    if (unchanged) {
      for (let index = start; index < end; index += 1) {
        // mergeLayoutEntries keeps unmodified geometry values by reference.
        // Missing entries also compare equal, preserving placeholder rows.
        if (previous!.geometryEntries.get(index) !== input.geometryEntries.get(index)) {
          unchanged = false;
          break;
        }
      }
    }
    const row = unchanged ? oldRow! : buildJustifiedRowGeometry({
      ...configuration,
      row: rowIndex,
      entryAt: index => input.geometryEntries.get(index) ?? {
        assetId: `__geometry__:${index}`, width: null, height: null,
      },
    });
    // Reflow may move later rows. Preserve old snapshots for the committed
    // anchor model; only the new offset wrapper changes, never old widths.
    rows.push(row.offset === offset ? row : { ...row, offset });
    offset += row.bodyHeight;
    if (end < configuration.total) offset += ASSET_GRID_GAP_PX;
  }
  const stableRows = compatible && rows.every((row, index) => row === previous.rows[index])
    ? previous.rows : rows;
  return { ...configuration, geometryEntries: input.geometryEntries, rows: stableRows };
}

export function buildJustifiedRowGeometry(input: {
  row: number;
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: CaptionBandSource;
  entryAt: (index: number) => BrowseLayoutEntry;
}): JustifiedRowGeometry {
  const start = input.row * input.itemsPerRow;
  const count = Math.min(input.itemsPerRow, input.total - start);
  const width = Math.max(1, Math.round(input.availableWidth));
  const targetHeight = Math.max(1, Math.round(input.targetHeight));
  const entries = Array.from({ length: Math.max(0, count) }, (_, itemOffset) =>
    input.entryAt(start + itemOffset));
  let captionBand = 0;
  for (const entry of entries) {
    captionBand = Math.max(captionBand, resolveCaptionBandSource(input.captionBand, entry));
  }
  const ratios = entries.map((entry) =>
    aspectRatioForAsset(entry.width, entry.height, entry.mediaType));
  const usable = Math.max(1, width - Math.max(0, count - 1) * ASSET_GRID_GAP_PX);
  const naturalWidth = ratios.reduce((sum, ratio) => sum + ratio, 0) * targetHeight;
  let scale = naturalWidth > 0 ? usable / naturalWidth : 1;
  const withholdStretch = count === 1 && start + count === input.total && scale > 1.18;
  if (withholdStretch) scale = 1;
  const previewHeight = Math.max(1, Math.round(targetHeight * scale));
  const widths = withholdStretch
    ? ratios.map((ratio) => Math.max(1, Math.round(ratio * previewHeight)))
    : distributeIntegerRowWidths(ratios, previewHeight, usable);
  return {
    previewHeight,
    bodyHeight: previewHeight + captionBand,
    captionBand,
    widths,
    offset: 0,
  };
}

export function buildJustifiedGeometry(input: {
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: CaptionBandSource;
  entryAt: (index: number) => BrowseLayoutEntry;
}): JustifiedRowGeometry[] {
  const total = Math.max(0, Math.trunc(input.total));
  const itemsPerRow = Math.max(1, Math.trunc(input.itemsPerRow));
  const width = Math.max(1, Math.round(input.availableWidth));
  const targetHeight = Math.max(1, Math.round(input.targetHeight));
  const rows: JustifiedRowGeometry[] = [];
  let offset = 0;
  for (let start = 0; start < total; start += itemsPerRow) {
    const row = buildJustifiedRowGeometry({
      row: rows.length,
      total,
      itemsPerRow,
      availableWidth: width,
      targetHeight,
      captionBand: input.captionBand,
      entryAt: input.entryAt,
    });
    rows.push({ ...row, offset });
    offset += row.bodyHeight;
    if (start + Math.min(itemsPerRow, total - start) < total) {
      offset += ASSET_GRID_GAP_PX;
    }
  }
  return rows;
}
