import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { AssetSummary, BrowseLayoutEntry } from "../shared/asset-types";
import { FONT_SIZE_SCALES } from "./font-size-preferences";
import {
  ASSET_GRID_GAP_PX,
  countFittingColumns,
  distributeMasonryItems,
} from "./asset-grid-layout";
import {
  MASONRY_CAPTION_BAND_PX,
  estimateMasonryCardBodyPx,
  layoutMasonryAssetRects,
  masonryColumnWidthPx,
  overlayLiveAssetGeometry,
  publishCanvasAssetLayout,
  stackItemHeights,
} from "./canvas-asset-layout";
import { isCanvasReflowRestorationPending } from "./canvas-reflow-restore";
import { scaleCaptionBandPx } from "./justified-caption-band";
import { estimateMasonryPreviewHeightPx } from "./masonry-preview-frame";
import { columnWindow, useCanvasLocalViewport } from "./viewport-window";
import { useFontSize } from "./FontSizeProvider";
import type { VirtualBrowseLayout } from "./browse/virtual-browse-layout";
import {
  VirtualMasonryColumns,
  type BrowseCardRenderOptions,
} from "./browse/virtual-browse-canvas";

export function masonryCardSlotStyle(args: {
  previewHeightPx: number;
  bodyHeightPx: number;
  isLast: boolean;
}): CSSProperties {
  const preview = Math.max(1, args.previewHeightPx);
  const body = Math.max(1, args.bodyHeightPx);
  return {
    height: body,
    flexShrink: 0,
    marginBottom: args.isLast ? undefined : ASSET_GRID_GAP_PX,
    ["--masonry-preview-height" as string]: `${preview}px`,
  };
}

type MasonryColumnsProps = {
  assets: AssetSummary[];
  layout: BrowseLayoutEntry[];
  virtualLayout?: VirtualBrowseLayout | null;
  cardSize: number;
  showCaption: boolean;
  captionBandPx?: number;
  suspendScrollRestoration?: boolean;
  renderCard: (
    asset: AssetSummary,
    options?: BrowseCardRenderOptions,
  ) => ReactNode;
  renderLayoutPreview?: (
    entry: BrowseLayoutEntry,
    options?: BrowseCardRenderOptions,
  ) => ReactNode;
};

export function MasonryColumns(props: MasonryColumnsProps) {
  const { preferences } = useFontSize();
  const captionBandPx = scaleCaptionBandPx(
    props.captionBandPx ?? MASONRY_CAPTION_BAND_PX,
    FONT_SIZE_SCALES[preferences.preference],
  );
  if (props.virtualLayout) {
    return (
      <VirtualMasonryColumns
        assets={props.assets}
        layout={props.virtualLayout}
        cardSize={props.cardSize}
        showCaption={props.showCaption}
        captionBandPx={captionBandPx}
        renderCard={props.renderCard}
        renderLayoutPreview={props.renderLayoutPreview}
      />
    );
  }
  return <RegularMasonryColumns {...props} captionBandPx={captionBandPx} />;
}

function RegularMasonryColumns({
  assets,
  layout,
  cardSize,
  showCaption,
  captionBandPx,
  suspendScrollRestoration = false,
  renderCard,
  renderLayoutPreview,
}: MasonryColumnsProps) {
  const resolvedCaptionBandPx = captionBandPx ?? MASONRY_CAPTION_BAND_PX;
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const availableWidthRef = useRef(0);
  const restoreFrameRef = useRef<number | null>(null);
  const scrollSnapshotRef = useRef<number | null>(null);
  const rawRestoreTargetRef = useRef<number | null>(null);
  const suspendScrollRestorationRef = useRef(suspendScrollRestoration);
  const viewport = useCanvasLocalViewport(containerRef, cardSize);

  useLayoutEffect(() => {
    suspendScrollRestorationRef.current = suspendScrollRestoration;
    if (!suspendScrollRestoration) return;
    if (restoreFrameRef.current !== null) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    scrollSnapshotRef.current = null;
    rawRestoreTargetRef.current = null;
  }, [suspendScrollRestoration]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const canvas = () => element.closest<HTMLElement>(".workspace-canvas");
    const scheduleRawRestore = () => {
      if (suspendScrollRestorationRef.current) return;
      if (restoreFrameRef.current !== null) return;
      const settle = (remaining: number) => {
        const root = canvas();
        const snapshot = scrollSnapshotRef.current;
        if (!root || snapshot === null) {
          restoreFrameRef.current = null;
          return;
        }
        root.scrollTop = Math.min(
          Math.max(0, snapshot),
          Math.max(0, root.scrollHeight - root.clientHeight),
        );
        rawRestoreTargetRef.current = root.scrollTop;
        if (remaining <= 0) {
          scrollSnapshotRef.current = null;
          rawRestoreTargetRef.current = null;
          restoreFrameRef.current = null;
          return;
        }
        restoreFrameRef.current = requestAnimationFrame(() => settle(remaining - 1));
      };
      restoreFrameRef.current = requestAnimationFrame(() => settle(12));
    };
    const updateWidth = () => {
      const width = element.clientWidth;
      const root = canvas();
      if (isCanvasReflowRestorationPending(root)) {
        availableWidthRef.current = width;
        scrollSnapshotRef.current = null;
        rawRestoreTargetRef.current = null;
        if (restoreFrameRef.current !== null) {
          cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = null;
        }
        setAvailableWidth(width);
        return;
      }
      if (suspendScrollRestorationRef.current) {
        availableWidthRef.current = width;
        scrollSnapshotRef.current = null;
        rawRestoreTargetRef.current = null;
        if (restoreFrameRef.current !== null) {
          cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = null;
        }
        setAvailableWidth(width);
        return;
      }
      const widthChanged = width !== availableWidthRef.current;
      if (widthChanged) {
        availableWidthRef.current = width;
        if (root) scrollSnapshotRef.current = root.scrollTop;
        rawRestoreTargetRef.current = null;
        setAvailableWidth(width);
      }
      if (scrollSnapshotRef.current !== null) {
        if (restoreFrameRef.current !== null) {
          cancelAnimationFrame(restoreFrameRef.current);
          restoreFrameRef.current = null;
        }
        scheduleRawRestore();
      }
    };
    const root = canvas();
    const cancelRawRestoreOnUserScroll = () => {
      const expected = rawRestoreTargetRef.current;
      if (
        expected !== null &&
        Math.abs((root?.scrollTop ?? 0) - expected) < 0.5
      ) {
        rawRestoreTargetRef.current = null;
        return;
      }
      scrollSnapshotRef.current = null;
      rawRestoreTargetRef.current = null;
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = null;
      }
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    root?.addEventListener("scroll", cancelRawRestoreOnUserScroll, { passive: true });
    return () => {
      observer.disconnect();
      root?.removeEventListener("scroll", cancelRawRestoreOnUserScroll);
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
      }
    };
  }, []);

  const fallbackLayout = useMemo(
    () => assets.map((asset) => ({
        assetId: asset.assetId,
        width: asset.width,
        height: asset.height,
        previewArtifactId: asset.thumbnailArtifactId,
      })),
    [assets],
  );
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset])),
    [assets],
  );
  const layoutEntries = useMemo(() => {
    const source = layout.length > 0 ? layout : fallbackLayout;
    return overlayLiveAssetGeometry(source, assetById);
  }, [assetById, fallbackLayout, layout]);
  const rankByAssetId = useMemo(
    () => new Map(layoutEntries.map((entry, index) => [entry.assetId, index] as const)),
    [layoutEntries],
  );
  const columnCount = countFittingColumns(availableWidth, cardSize);
  const columnWidth = masonryColumnWidthPx(availableWidth, columnCount);
  const distributed = useMemo(
    () => distributeMasonryItems(
      layoutEntries,
      columnCount,
      (asset) => estimateMasonryCardBodyPx(
        asset,
        columnWidth,
        showCaption,
        resolvedCaptionBandPx,
      ),
    ),
    [columnCount, columnWidth, layoutEntries, resolvedCaptionBandPx, showCaption],
  );
  const layoutRects = useMemo(
    () => layoutMasonryAssetRects(
      layoutEntries,
      availableWidth,
      cardSize,
      showCaption,
      resolvedCaptionBandPx,
    ),
    [availableWidth, cardSize, layoutEntries, resolvedCaptionBandPx, showCaption],
  );
  const columnMetrics = useMemo(
    () => distributed.map((column) => ({
      bodies: column.items.map((asset) =>
        estimateMasonryCardBodyPx(
          asset,
          columnWidth,
          showCaption,
          resolvedCaptionBandPx,
        )),
      previews: column.items.map((asset) =>
        estimateMasonryPreviewHeightPx(asset.width, asset.height, columnWidth)),
    })),
    [columnWidth, distributed, resolvedCaptionBandPx, showCaption],
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    publishCanvasAssetLayout(element, layoutRects);
  }, [layoutRects]);

  return (
    <div
      className="masonry-columns"
      ref={containerRef}
      style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
    >
      {distributed.map((column, index) => {
        const previews = columnMetrics[index]!.previews;
        const bodies = columnMetrics[index]!.bodies;
        const visibleWindow = columnWindow(
          stackItemHeights(bodies),
          viewport.start,
          viewport.end,
        );
        return (
          <div
            className="masonry-column"
            key={`masonry-column-${index}`}
            style={{
              gap: 0,
              minHeight: visibleWindow.totalHeight,
            }}
          >
            {visibleWindow.spacerBefore > 0 ? (
              <div
                aria-hidden
                style={{ height: visibleWindow.spacerBefore, flexShrink: 0 }}
              />
            ) : null}
            {column.items.slice(visibleWindow.start, visibleWindow.end).map((entry, offset) => {
              const itemIndex = visibleWindow.start + offset;
              const isLast = itemIndex === column.items.length - 1;
              const asset = assetById.get(entry.assetId);
              return (
                <div
                  className="masonry-card-slot"
                  data-layout-asset-id={entry.assetId}
                  data-layout-rank={rankByAssetId.get(entry.assetId)}
                  key={entry.assetId}
                  style={masonryCardSlotStyle({
                    previewHeightPx: previews[itemIndex]!,
                    bodyHeightPx: bodies[itemIndex]!,
                    isLast,
                  })}
                >
                  {asset ? renderCard(asset) : renderLayoutPreview?.(entry)}
                </div>
              );
            })}
            {visibleWindow.spacerAfter > 0 ? (
              <div
                aria-hidden
                style={{ height: visibleWindow.spacerAfter, flexShrink: 0 }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
