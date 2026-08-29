import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { AssetSummary, BrowseLayoutEntry } from "../../shared/asset-types";
import {
  ASSET_GRID_GAP_PX,
  aspectRatioForAsset,
  countFittingColumns,
  distributeIntegerRowWidths,
} from "../asset-grid-layout";
import {
  estimateMasonryCardBodyPx,
  masonryColumnWidthPx,
  MASONRY_CAPTION_BAND_PX,
  publishCanvasAssetLayoutIndex,
  type CanvasAssetLayoutIndex,
} from "../canvas-asset-layout";
import { resolveJustifiedCaptionBandPx } from "../justified-caption-band";
import {
  itemIntersectsVisibleRange,
  useCanvasLocalViewport,
} from "../viewport-window";
import {
  type VirtualBrowseLayout,
  virtualLayoutEntryAt,
} from "./virtual-browse-layout";

const JUSTIFIED_CAPTION_BAND_PX = resolveJustifiedCaptionBandPx({
  dimensions: true,
  name: true,
  secondary: true,
});

function virtualMasonryCardSlotStyle(input: {
  previewHeightPx: number;
  bodyHeightPx: number;
  isLast: boolean;
}): CSSProperties {
  const preview = Math.max(1, input.previewHeightPx);
  const body = Math.max(1, input.bodyHeightPx);
  return {
    height: body,
    flexShrink: 0,
    marginBottom: input.isLast ? undefined : ASSET_GRID_GAP_PX,
    ["--masonry-preview-height" as string]: `${preview}px`,
  };
}

function virtualJustifiedSlotStyle(input: {
  id: string;
  width: number;
  height: number;
}): CSSProperties {
  void input.id;
  return {
    width: Math.max(1, Math.round(input.width)),
    ["--justified-preview-height" as string]: `${Math.max(1, Math.round(input.height))}px`,
  };
}

/**
 * Lock the justified row's used height to the geometry body. Caption/font
 * overflow must not grow the row, or loadImmediately offsets drift above the
 * real viewport and the top visible cards lose their thumbnails
 * (Serpent-614293). Masonry already does this with an explicit slot height.
 */
export function virtualJustifiedRowStyle(input: {
  bodyHeightPx: number;
  isLast: boolean;
}): CSSProperties {
  return {
    height: Math.max(1, Math.round(input.bodyHeightPx)),
    flexShrink: 0,
    overflow: "hidden",
    marginBottom: input.isLast ? undefined : ASSET_GRID_GAP_PX,
  };
}

type VariableWindow = {
  start: number;
  end: number;
  spacerBefore: number;
  spacerAfter: number;
  totalHeight: number;
};

type IndexedRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowseCardRenderOptions = {
  /** High priority is reserved for cards intersecting the real viewport. */
  loadImmediately: boolean;
};

export function variableWindow(input: {
  heights: readonly number[];
  offsets: readonly number[];
  totalHeight: number;
  viewStart: number;
  viewEnd: number;
}): VariableWindow {
  const count = input.heights.length;
  if (count <= 0) {
    return { start: 0, end: 0, spacerBefore: 0, spacerAfter: 0, totalHeight: 0 };
  }
  const top = Number.isFinite(input.viewStart) ? Math.max(0, input.viewStart) : 0;
  const bottom = Number.isFinite(input.viewEnd)
    ? Math.max(top, input.viewEnd)
    : input.totalHeight;
  const firstVisible = (offset: number): number => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const end = input.offsets[middle]! + input.heights[middle]!;
      if (end <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const firstAfter = (offset: number): number => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (input.offsets[middle]! < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = Math.min(count - 1, firstVisible(top));
  const end = Math.min(count, Math.max(start + 1, firstAfter(bottom)));
  const cursor = end >= count ? input.totalHeight : input.offsets[end]!;
  return {
    start,
    end,
    spacerBefore: input.offsets[start] ?? 0,
    spacerAfter: Math.max(0, input.totalHeight - cursor),
    totalHeight: input.totalHeight,
  };
}

type GeometrySequence = {
  count: number;
  totalHeight: number;
  heightAt: (index: number) => number;
  offsetAt: (index: number) => number;
};

/** Same window contract as variableWindow, backed by bounded geometry blocks. */
function variableWindowForSequence(
  sequence: GeometrySequence,
  viewStart: number,
  viewEnd: number,
): VariableWindow {
  const count = sequence.count;
  if (count <= 0) {
    return { start: 0, end: 0, spacerBefore: 0, spacerAfter: 0, totalHeight: 0 };
  }
  const top = Number.isFinite(viewStart) ? Math.max(0, viewStart) : 0;
  const bottom = Number.isFinite(viewEnd)
    ? Math.max(top, viewEnd)
    : sequence.totalHeight;
  const firstVisible = (offset: number): number => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const end = sequence.offsetAt(middle) + sequence.heightAt(middle);
      if (end <= offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const firstAfter = (offset: number): number => {
    let low = 0;
    let high = count;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (sequence.offsetAt(middle) < offset) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const start = Math.min(count - 1, firstVisible(top));
  const end = Math.min(count, Math.max(start + 1, firstAfter(bottom)));
  const cursor = end >= count ? sequence.totalHeight : sequence.offsetAt(end);
  return {
    start,
    end,
    spacerBefore: sequence.offsetAt(start),
    spacerAfter: Math.max(0, sequence.totalHeight - cursor),
    totalHeight: sequence.totalHeight,
  };
}

function localBoxIntersects(
  item: { x: number; y: number; width: number; height: number },
  box: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    item.x < box.right
    && item.x + item.width > box.left
    && item.y < box.bottom
    && item.y + item.height > box.top
  );
}

function assertFinitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

type MasonryColumnGeometry = {
  heights: number[];
  offsets: number[];
  totalHeight: number;
  count: number;
  heightAt: (row: number) => number;
  offsetAt: (row: number) => number;
};

const GEOMETRY_BLOCK_SIZE = 128;
const GEOMETRY_MATERIALIZATION_LIMIT = 20_000;

function denseMasonryColumnGeometry(
  heights: number[],
  offsets: number[],
  totalHeight: number,
): MasonryColumnGeometry {
  return {
    heights,
    offsets,
    totalHeight,
    count: heights.length,
    heightAt: (row) => heights[row] ?? 1,
    offsetAt: (row) => offsets[row] ?? totalHeight,
  };
}

export function buildMasonryGeometry(input: {
  total: number;
  columnCount: number;
  columnWidth: number;
  showCaption: boolean;
  captionBand: number;
  entryAt: (index: number) => BrowseLayoutEntry;
}): MasonryColumnGeometry[] {
  const total = Math.max(0, Math.trunc(input.total));
  const columns = Math.max(1, Math.trunc(input.columnCount));
  const width = assertFinitePositive(input.columnWidth, 1);
  return Array.from({ length: columns }, (_, columnIndex) => {
    const itemCount = Math.max(0, Math.ceil((total - columnIndex) / columns));
    const heights: number[] = [];
    const offsets: number[] = [];
    let cursor = 0;
    for (let row = 0; row < itemCount; row += 1) {
      const index = row * columns + columnIndex;
      const height = assertFinitePositive(
        estimateMasonryCardBodyPx(
          input.entryAt(index),
          width,
          input.showCaption,
          input.captionBand,
        ),
        1,
      );
      offsets.push(cursor);
      heights.push(height);
      cursor += height;
      if (row < itemCount - 1) cursor += ASSET_GRID_GAP_PX;
    }
    return denseMasonryColumnGeometry(heights, offsets, cursor);
  });
}

/**
 * Build masonry geometry without materializing every placeholder row. The
 * session owns only a bounded sparse map of real dimensions; unknown rows use
 * the same square-ish estimate as the existing placeholder card. Block
 * checkpoints make scrollbar jumps logarithmic while each visible block is
 * resolved at most once per layout query.
 */
export function buildChunkedMasonryGeometry(input: {
  total: number;
  columnCount: number;
  columnWidth: number;
  showCaption: boolean;
  captionBand: number;
  geometryEntries: ReadonlyMap<number, BrowseLayoutEntry>;
}): MasonryColumnGeometry[] {
  const total = Math.max(0, Math.trunc(input.total));
  const columns = Math.max(1, Math.trunc(input.columnCount));
  const width = assertFinitePositive(input.columnWidth, 1);
  const defaultHeight = assertFinitePositive(
    estimateMasonryCardBodyPx(
      { width: null, height: null },
      width,
      input.showCaption,
      input.captionBand,
    ),
    1,
  );
  return Array.from({ length: columns }, (_, columnIndex) => {
    const count = Math.max(0, Math.ceil((total - columnIndex) / columns));
    const overrides = new Map<number, number>();
    for (const [index, entry] of input.geometryEntries) {
      if (index % columns !== columnIndex) continue;
      const row = Math.floor(index / columns);
      if (row < 0 || row >= count) continue;
      overrides.set(
        row,
        assertFinitePositive(
          estimateMasonryCardBodyPx(
            entry,
            width,
            input.showCaption,
            input.captionBand,
          ),
          defaultHeight,
        ),
      );
    }
    const blockCount = Math.ceil(count / GEOMETRY_BLOCK_SIZE);
    const blockOffsets = new Array<number>(blockCount);
    let totalHeight = 0;
    for (let block = 0; block < blockCount; block += 1) {
      const start = block * GEOMETRY_BLOCK_SIZE;
      const end = Math.min(count, start + GEOMETRY_BLOCK_SIZE);
      let blockHeight = 0;
      for (let row = start; row < end; row += 1) {
        blockHeight += overrides.get(row) ?? defaultHeight;
        if (row < count - 1) blockHeight += ASSET_GRID_GAP_PX;
      }
      blockOffsets[block] = totalHeight;
      totalHeight += blockHeight;
    }
    const heightAt = (row: number): number => (
      overrides.get(row) ?? defaultHeight
    );
    const offsetAt = (row: number): number => {
      if (row <= 0) return 0;
      if (row >= count) return totalHeight;
      const block = Math.floor(row / GEOMETRY_BLOCK_SIZE);
      let offset = blockOffsets[block] ?? 0;
      const start = block * GEOMETRY_BLOCK_SIZE;
      for (let current = start; current < row; current += 1) {
        offset += heightAt(current);
        if (current < count - 1) offset += ASSET_GRID_GAP_PX;
      }
      return offset;
    };
    return {
      heights: [],
      offsets: [],
      totalHeight,
      count,
      heightAt,
      offsetAt,
    };
  });
}

function makeMasonryLayoutIndex(input: {
  total: number;
  columnCount: number;
  columnWidth: number;
  columns: readonly MasonryColumnGeometry[];
  idAt: (index: number) => string | undefined;
}): CanvasAssetLayoutIndex {
  const total = Math.max(0, Math.trunc(input.total));
  const columns = Math.max(1, Math.trunc(input.columnCount));
  const width = assertFinitePositive(input.columnWidth, 1);
  const rectAt = (index: number): IndexedRect | null => {
    const id = input.idAt(index);
    if (!id) return null;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const geometry = input.columns[column];
    if (!geometry || row < 0 || row >= geometry.count) return null;
    return {
      id,
      x: column * (width + ASSET_GRID_GAP_PX),
      y: geometry.offsetAt(row),
      width,
      height: geometry.heightAt(row),
    };
  };
  return {
    total,
    forEachIntersecting: (box, visit) => {
      if (total <= 0) return;
      const firstColumn = Math.max(
        0,
        Math.floor(Math.max(0, box.left) / (width + ASSET_GRID_GAP_PX)) - 1,
      );
      const lastColumn = Math.min(
        columns - 1,
        Math.floor(Math.max(0, box.right) / (width + ASSET_GRID_GAP_PX)),
      );
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const geometry = input.columns[column];
        if (!geometry) continue;
        const window = variableWindowForSequence({
          count: geometry.count,
          heightAt: geometry.heightAt,
          offsetAt: geometry.offsetAt,
          totalHeight: geometry.totalHeight,
        }, box.top, box.bottom);
        const firstRow = Math.max(0, window.start - 1);
        const lastRow = Math.min(geometry.count, window.end + 1);
        for (let row = firstRow; row < lastRow; row += 1) {
          const index = row * columns + column;
          if (index >= total) continue;
          const rect = rectAt(index);
          if (rect && localBoxIntersects(rect, box)) visit(rect);
        }
      }
    },
    forEachAll: (visit) => {
      for (let index = 0; index < total; index += 1) {
        const rect = rectAt(index);
        if (rect) visit(rect);
      }
    },
  };
}

type JustifiedRowGeometry = {
  previewHeight: number;
  bodyHeight: number;
  widths: number[];
  offset: number;
};

type JustifiedGeometryModel = {
  count: number;
  totalHeight: number;
  rowAt: (row: number) => JustifiedRowGeometry;
  heightAt: (row: number) => number;
  offsetAt: (row: number) => number;
};

function buildJustifiedRowGeometry(input: {
  row: number;
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: number;
  entryAt: (index: number) => BrowseLayoutEntry;
}): JustifiedRowGeometry {
  const start = input.row * input.itemsPerRow;
  const count = Math.min(input.itemsPerRow, input.total - start);
  const width = Math.max(1, Math.round(input.availableWidth));
  const targetHeight = Math.max(1, Math.round(input.targetHeight));
  const captionBand = Math.max(0, input.captionBand);
  const ratios = Array.from({ length: Math.max(0, count) }, (_, itemOffset) => {
    const entry = input.entryAt(start + itemOffset);
    return aspectRatioForAsset(entry.width, entry.height);
  });
  const usable = Math.max(1, width - Math.max(0, count - 1) * ASSET_GRID_GAP_PX);
  const naturalWidth = ratios.reduce((sum, ratio) => sum + ratio, 0) * targetHeight;
  let scale = naturalWidth > 0 ? usable / naturalWidth : 1;
  const withholdStretch = count === 1 && start + count === input.total && scale > 1.18;
  if (withholdStretch) scale = 1;
  const previewHeight = Math.max(1, Math.round(targetHeight * scale));
  const widths = withholdStretch
    ? ratios.map((ratio) => Math.max(1, Math.round(ratio * previewHeight)))
    : distributeIntegerRowWidths(ratios, previewHeight, usable);
  return { previewHeight, bodyHeight: previewHeight + captionBand, widths, offset: 0 };
}

export function buildJustifiedGeometry(input: {
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: number;
  entryAt: (index: number) => BrowseLayoutEntry;
}): JustifiedRowGeometry[] {
  const total = Math.max(0, Math.trunc(input.total));
  const itemsPerRow = Math.max(1, Math.trunc(input.itemsPerRow));
  const width = Math.max(1, Math.round(input.availableWidth));
  const targetHeight = Math.max(1, Math.round(input.targetHeight));
  const captionBand = Math.max(0, input.captionBand);
  const rows: JustifiedRowGeometry[] = [];
  let offset = 0;
  for (let start = 0; start < total; start += itemsPerRow) {
    const row = buildJustifiedRowGeometry({
      row: rows.length,
      total,
      itemsPerRow,
      availableWidth: width,
      targetHeight,
      captionBand,
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

function justifiedModelFromDenseRows(
  rows: readonly JustifiedRowGeometry[],
): JustifiedGeometryModel {
  const count = rows.length;
  const totalHeight = count === 0
    ? 0
    : rows[count - 1]!.offset + rows[count - 1]!.bodyHeight;
  return {
    count,
    totalHeight,
    rowAt: (row) => rows[row] ?? {
      previewHeight: 1,
      bodyHeight: 1,
      widths: [],
      offset: totalHeight,
    },
    heightAt: (row) => rows[row]?.bodyHeight ?? 1,
    offsetAt: (row) => rows[row]?.offset ?? totalHeight,
  };
}

export function buildChunkedJustifiedGeometry(input: {
  total: number;
  itemsPerRow: number;
  availableWidth: number;
  targetHeight: number;
  captionBand: number;
  geometryEntries: ReadonlyMap<number, BrowseLayoutEntry>;
}): JustifiedGeometryModel {
  const total = Math.max(0, Math.trunc(input.total));
  const itemsPerRow = Math.max(1, Math.trunc(input.itemsPerRow));
  const count = Math.ceil(total / itemsPerRow);
  const placeholder = (index: number): BrowseLayoutEntry => (
    input.geometryEntries.get(index) ?? {
      assetId: `__geometry__:${index}`,
      width: null,
      height: null,
    }
  );
  const knownRows = new Set<number>();
  for (const index of input.geometryEntries.keys()) {
    if (index < 0 || index >= total) continue;
    knownRows.add(Math.floor(index / itemsPerRow));
  }
  const rowOverrides = new Map<number, JustifiedRowGeometry>();
  for (const row of knownRows) {
    rowOverrides.set(row, buildJustifiedRowGeometry({
      row,
      total,
      itemsPerRow,
      availableWidth: input.availableWidth,
      targetHeight: input.targetHeight,
      captionBand: input.captionBand,
      entryAt: placeholder,
    }));
  }
  const normalDefault = count > 1
    ? buildJustifiedRowGeometry({
        row: 0,
        total: count * itemsPerRow,
        itemsPerRow,
        availableWidth: input.availableWidth,
        targetHeight: input.targetHeight,
        captionBand: input.captionBand,
        entryAt: () => ({ assetId: '__geometry__', width: null, height: null }),
      })
    : undefined;
  const lastDefault = count > 0
    ? buildJustifiedRowGeometry({
        row: count - 1,
        total,
        itemsPerRow,
        availableWidth: input.availableWidth,
        targetHeight: input.targetHeight,
        captionBand: input.captionBand,
        entryAt: () => ({ assetId: '__geometry__', width: null, height: null }),
      })
    : undefined;
  const defaultRowAt = (row: number): JustifiedRowGeometry => (
    row === count - 1 ? lastDefault! : normalDefault!
  );
  const rowGeometryWithoutOffset = (row: number): JustifiedRowGeometry => (
    rowOverrides.get(row) ?? defaultRowAt(row)
  );
  const blockCount = Math.ceil(count / GEOMETRY_BLOCK_SIZE);
  const blockOffsets = new Array<number>(blockCount);
  let totalHeight = 0;
  for (let block = 0; block < blockCount; block += 1) {
    const start = block * GEOMETRY_BLOCK_SIZE;
    const end = Math.min(count, start + GEOMETRY_BLOCK_SIZE);
    let blockHeight = 0;
    for (let row = start; row < end; row += 1) {
      blockHeight += rowGeometryWithoutOffset(row).bodyHeight;
      if (row < count - 1) blockHeight += ASSET_GRID_GAP_PX;
    }
    blockOffsets[block] = totalHeight;
    totalHeight += blockHeight;
  }
  const heightAt = (row: number): number => rowGeometryWithoutOffset(row).bodyHeight;
  const offsetAt = (row: number): number => {
    if (row <= 0) return 0;
    if (row >= count) return totalHeight;
    const block = Math.floor(row / GEOMETRY_BLOCK_SIZE);
    let offset = blockOffsets[block] ?? 0;
    const start = block * GEOMETRY_BLOCK_SIZE;
    for (let current = start; current < row; current += 1) {
      offset += heightAt(current);
      if (current < count - 1) offset += ASSET_GRID_GAP_PX;
    }
    return offset;
  };
  const rowCache = new Map<number, JustifiedRowGeometry>();
  const rowAt = (row: number): JustifiedRowGeometry => {
    const cached = rowCache.get(row);
    if (cached) return cached;
    const geometry = {
      ...rowGeometryWithoutOffset(row),
      offset: offsetAt(row),
    };
    rowCache.set(row, geometry);
    while (rowCache.size > GEOMETRY_BLOCK_SIZE * 2) {
      rowCache.delete(rowCache.keys().next().value!);
    }
    return geometry;
  };
  return { count, totalHeight, rowAt, heightAt, offsetAt };
}

function makeJustifiedLayoutIndex(input: {
  total: number;
  itemsPerRow: number;
  geometry: JustifiedGeometryModel;
  idAt: (index: number) => string | undefined;
}): CanvasAssetLayoutIndex {
  const total = Math.max(0, Math.trunc(input.total));
  const itemsPerRow = Math.max(1, Math.trunc(input.itemsPerRow));
  const rectAt = (index: number) => {
    const id = input.idAt(index);
    if (!id) return null;
    const row = Math.floor(index / itemsPerRow);
    const column = index % itemsPerRow;
    const geometry = input.geometry.rowAt(row);
    if (!geometry || geometry.widths[column] === undefined) return null;
    return {
      id,
      x: geometry.widths
        .slice(0, column)
        .reduce((sum, itemWidth) => sum + itemWidth + ASSET_GRID_GAP_PX, 0),
      y: input.geometry.offsetAt(row),
      width: geometry.widths[column]!,
      height: geometry.bodyHeight,
    };
  };
  return {
    total,
    forEachIntersecting: (box, visit) => {
      if (total <= 0) return;
      const window = variableWindowForSequence({
        count: input.geometry.count,
        heightAt: input.geometry.heightAt,
        offsetAt: input.geometry.offsetAt,
        totalHeight: input.geometry.totalHeight,
      }, box.top, box.bottom);
      const firstRow = Math.max(0, window.start - 1);
      const lastRow = Math.min(input.geometry.count, window.end + 1);
      for (let row = firstRow; row < lastRow; row += 1) {
        const count = input.geometry.rowAt(row).widths.length;
        for (let column = 0; column < count; column += 1) {
          const index = row * itemsPerRow + column;
          if (index >= total) continue;
          const rect = rectAt(index);
          if (rect && localBoxIntersects(rect, box)) visit(rect);
        }
      }
    },
    forEachAll: (visit) => {
      for (let index = 0; index < total; index += 1) {
        const rect = rectAt(index);
        if (rect) visit(rect);
      }
    },
  };
}

/**
 * Geometry blocks arrive after the first paint. Keep the first logical slot
 * near the viewport top as an anchor and compensate only the delta introduced
 * by newly-known dimensions. This prevents a late portrait/landscape block
 * from moving the user's scrollbar target while preserving native scrolling.
 */
function useVirtualScrollAnchor(
  containerRef: { current: HTMLDivElement | null },
  geometryRevision: number,
): void {
  const anchorRef = useRef<{ index: number; localTop: number } | null>(null);
  const captureRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = container.closest<HTMLElement>(".workspace-canvas");
    if (!canvas) return;
    const findSlot = (index: number): HTMLElement | undefined => {
      for (const slot of container.querySelectorAll<HTMLElement>("[data-layout-index]")) {
        if (Number(slot.dataset.layoutIndex) === index) return slot;
      }
      return undefined;
    };
    const findFirstVisibleSlot = (canvasRect: DOMRect): {
      index: number;
      rect: DOMRect;
    } | undefined => {
      let first: { index: number; rect: DOMRect } | undefined;
      for (const slot of container.querySelectorAll<HTMLElement>("[data-layout-index]")) {
        const index = Number(slot.dataset.layoutIndex);
        if (!Number.isSafeInteger(index) || index < 0) continue;
        const rect = slot.getBoundingClientRect();
        if (rect.bottom <= canvasRect.top) continue;
        if (!first || rect.top < first.rect.top) first = { index, rect };
      }
      return first;
    };
    const capture = () => {
      const canvasRect = canvas.getBoundingClientRect();
      const anchor = anchorRef.current;
      const currentSlot = anchor ? findSlot(anchor.index) : undefined;
      const currentRect = currentSlot?.getBoundingClientRect();
      const first = currentSlot && currentRect && currentRect.bottom > canvasRect.top
        ? { index: anchor!.index, rect: currentRect }
        : findFirstVisibleSlot(canvasRect);
      if (!first) return;
      anchorRef.current = {
        index: first.index,
        localTop: first.rect.top - canvasRect.top,
      };
    };
    captureRef.current = capture;
    capture();
    let frame: number | null = null;
    const scheduleCapture = () => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        capture();
      });
    };
    canvas.addEventListener("scroll", scheduleCapture, { passive: true });
    return () => {
      canvas.removeEventListener("scroll", scheduleCapture);
      if (frame !== null) window.cancelAnimationFrame(frame);
      captureRef.current = () => undefined;
    };
  }, [containerRef]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const canvas = container?.closest<HTMLElement>(".workspace-canvas");
    const anchor = anchorRef.current;
    if (!container || !canvas || !anchor) return;
    const slot = [...container.querySelectorAll<HTMLElement>("[data-layout-index]")]
      .find((candidate) => Number(candidate.dataset.layoutIndex) === anchor.index);
    if (!slot) {
      captureRef.current();
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const nextLocalTop = slot.getBoundingClientRect().top - canvasRect.top;
    const delta = nextLocalTop - anchor.localTop;
    if (Math.abs(delta) > 0.5) {
      const maxScroll = Math.max(0, canvas.scrollHeight - canvas.clientHeight);
      canvas.scrollTop = Math.min(maxScroll, Math.max(0, canvas.scrollTop + delta));
    }
    captureRef.current();
  }, [containerRef, geometryRevision]);
}

export function VirtualMasonryColumns({
  assets,
  layout,
  cardSize,
  showCaption,
  captionBandPx,
  renderCard,
  renderLayoutPreview,
}: {
  assets: AssetSummary[];
  layout: VirtualBrowseLayout;
  cardSize: number;
  showCaption: boolean;
  captionBandPx?: number;
  renderCard: (
    asset: AssetSummary,
    options: BrowseCardRenderOptions,
  ) => ReactNode;
  renderLayoutPreview?: (
    entry: ReturnType<typeof virtualLayoutEntryAt>,
    options: BrowseCardRenderOptions,
  ) => ReactNode;
}) {
  const resolvedCaptionBandPx = captionBandPx ?? MASONRY_CAPTION_BAND_PX;
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const viewport = useCanvasLocalViewport(containerRef, cardSize);
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset] as const)),
    [assets],
  );
  const columnCount = countFittingColumns(availableWidth, cardSize);
  const columnWidth = masonryColumnWidthPx(availableWidth, columnCount);
  const geometry = useMemo(
    () => layout.total > GEOMETRY_MATERIALIZATION_LIMIT
      ? buildChunkedMasonryGeometry({
          total: layout.total,
          columnCount,
          columnWidth,
          showCaption,
          captionBand: resolvedCaptionBandPx,
          geometryEntries: layout.geometryEntries,
        })
      : buildMasonryGeometry({
          total: layout.total,
          columnCount,
          columnWidth,
          showCaption,
          captionBand: resolvedCaptionBandPx,
          entryAt: (index) => layout.geometryEntries.get(index) ?? {
            assetId: `__geometry__:${index}`,
            width: null,
            height: null,
          },
        }),
    [columnCount, columnWidth, layout.geometryEntries, layout.total, resolvedCaptionBandPx, showCaption],
  );
  useVirtualScrollAnchor(containerRef, layout.geometryRevision);
  const layoutIndex = useMemo(
    () => makeMasonryLayoutIndex({
      total: layout.total,
      columnCount,
      columnWidth,
      columns: geometry,
      idAt: (index) => layout.assetIdsByIndex.get(index),
    }),
    [columnCount, columnWidth, geometry, layout.assetIdsByIndex, layout.total],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    publishCanvasAssetLayoutIndex(element, layoutIndex);
  }, [layoutIndex]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="masonry-columns"
      ref={containerRef}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: columnCount }, (_, columnIndex) => {
        const column = geometry[columnIndex]!;
        const itemCount = column.count;
        const visibleWindow = variableWindowForSequence({
          count: column.count,
          heightAt: column.heightAt,
          offsetAt: column.offsetAt,
          totalHeight: column.totalHeight,
        }, viewport.start, viewport.end);
        return (
          <div
            className="masonry-column"
            key={`virtual-masonry-column-${columnIndex}`}
            style={{ gap: 0, minHeight: visibleWindow.totalHeight }}
          >
            {visibleWindow.spacerBefore > 0 ? (
              <div aria-hidden style={{ height: visibleWindow.spacerBefore, flexShrink: 0 }} />
            ) : null}
            {Array.from(
              { length: visibleWindow.end - visibleWindow.start },
              (_, offset) => {
                const row = visibleWindow.start + offset;
                const index = row * columnCount + columnIndex;
                const entry = virtualLayoutEntryAt(layout, index);
                const asset = assetById.get(entry.assetId);
                const isLast = row === itemCount - 1;
                const bodyHeight = column.heightAt(row);
                const cardTop = column.offsetAt(row);
                const loadImmediately = itemIntersectsVisibleRange(
                  cardTop,
                  bodyHeight,
                  viewport.visibleStart,
                  viewport.visibleEnd,
                );
                return (
                  <div
                    className="masonry-card-slot"
                    data-layout-asset-id={entry.assetId}
                    data-layout-index={index}
                    data-layout-rank={index}
                    key={`${entry.assetId}-${index}`}
                    style={virtualMasonryCardSlotStyle({
                      previewHeightPx: Math.max(1, bodyHeight - (showCaption ? resolvedCaptionBandPx : 0)),
                      bodyHeightPx: bodyHeight,
                      isLast,
                    })}
                  >
                    {asset
                      ? renderCard(asset, { loadImmediately })
                      : renderLayoutPreview?.(entry, { loadImmediately })}
                  </div>
                );
              },
            )}
            {visibleWindow.spacerAfter > 0 ? (
              <div aria-hidden style={{ height: visibleWindow.spacerAfter, flexShrink: 0 }} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function VirtualJustifiedAssetRows({
  assets,
  layout,
  cardSize,
  renderCard,
  renderLayoutPreview,
}: {
  assets: AssetSummary[];
  layout: VirtualBrowseLayout;
  cardSize: number;
  renderCard: (
    asset: AssetSummary,
    options: BrowseCardRenderOptions,
  ) => ReactNode;
  renderLayoutPreview?: (
    entry: ReturnType<typeof virtualLayoutEntryAt>,
    options: BrowseCardRenderOptions,
  ) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const viewport = useCanvasLocalViewport(containerRef, cardSize);
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset] as const)),
    [assets],
  );
  const itemsPerRow = Math.max(
    1,
    Math.floor((Math.max(0, availableWidth) + ASSET_GRID_GAP_PX) / (Math.max(1, cardSize) + ASSET_GRID_GAP_PX)),
  );
  const captionBandPx = JUSTIFIED_CAPTION_BAND_PX;
  const geometry = useMemo(
    () => layout.total > GEOMETRY_MATERIALIZATION_LIMIT
      ? buildChunkedJustifiedGeometry({
          total: layout.total,
          itemsPerRow,
          availableWidth,
          targetHeight: cardSize,
          captionBand: captionBandPx,
          geometryEntries: layout.geometryEntries,
        })
      : justifiedModelFromDenseRows(buildJustifiedGeometry({
          total: layout.total,
          itemsPerRow,
          availableWidth,
          targetHeight: cardSize,
          captionBand: captionBandPx,
          entryAt: (index) => layout.geometryEntries.get(index) ?? {
            assetId: `__geometry__:${index}`,
            width: null,
            height: null,
          },
        })),
    [availableWidth, captionBandPx, cardSize, itemsPerRow, layout.geometryEntries, layout.total],
  );
  useVirtualScrollAnchor(containerRef, layout.geometryRevision);
  const layoutIndex = useMemo(
    () => makeJustifiedLayoutIndex({
      total: layout.total,
      itemsPerRow,
      geometry,
      idAt: (index) => layout.assetIdsByIndex.get(index),
    }),
    [geometry, itemsPerRow, layout.assetIdsByIndex, layout.total],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    publishCanvasAssetLayoutIndex(element, layoutIndex);
  }, [layoutIndex]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rowWindow = variableWindowForSequence({
    count: geometry.count,
    heightAt: geometry.heightAt,
    offsetAt: geometry.offsetAt,
    totalHeight: geometry.totalHeight,
  }, viewport.start, viewport.end);

  return (
    <div
      className="justified-rows"
      ref={containerRef}
      style={{
        gap: 0,
        minHeight: rowWindow.totalHeight,
        ["--justified-caption-band" as string]: `${captionBandPx}px`,
      }}
    >
      {rowWindow.spacerBefore > 0 ? (
        <div aria-hidden style={{ height: rowWindow.spacerBefore, flexShrink: 0 }} />
      ) : null}
      {Array.from({ length: rowWindow.end - rowWindow.start }, (_, offset) => {
        const rowIndex = rowWindow.start + offset;
        const rowGeometry = geometry.rowAt(rowIndex);
        const start = rowIndex * itemsPerRow;
        const count = rowGeometry?.widths.length ?? 0;
        const rowTop = rowGeometry?.offset ?? 0;
        const bodyHeight = rowGeometry?.bodyHeight ?? 0;
        const loadImmediately = itemIntersectsVisibleRange(
          rowTop,
          bodyHeight,
          viewport.visibleStart,
          viewport.visibleEnd,
        );
        return (
          <div
            className="justified-row"
            key={`virtual-justified-row-${rowIndex}`}
            style={virtualJustifiedRowStyle({
              bodyHeightPx: bodyHeight,
              isLast: rowIndex === geometry.count - 1,
            })}
          >
            {Array.from({ length: Math.max(0, count) }, (_, itemOffset) => {
              const index = start + itemOffset;
              const entry = virtualLayoutEntryAt(layout, index);
              const asset = assetById.get(entry.assetId);
              return (
                <div
                  aria-hidden={asset ? undefined : true}
                  className="justified-card-slot"
                  data-layout-asset-id={entry.assetId}
                  data-layout-index={index}
                  key={`${entry.assetId}-${index}`}
                  style={virtualJustifiedSlotStyle({
                    id: entry.assetId,
                    width: rowGeometry?.widths[itemOffset] ?? 1,
                    height: rowGeometry?.previewHeight ?? 1,
                  })}
                >
                  {asset
                    ? renderCard(asset, { loadImmediately })
                    : renderLayoutPreview?.(entry, { loadImmediately })}
                </div>
              );
            })}
          </div>
        );
      })}
      {rowWindow.spacerAfter > 0 ? (
        <div aria-hidden style={{ height: rowWindow.spacerAfter, flexShrink: 0 }} />
      ) : null}
    </div>
  );
}
