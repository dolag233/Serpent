import { observeCanvasLayoutMeasure } from "./canvas-layout-measure";
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { AssetSummary, BrowseLayoutEntry } from "../shared/asset-types";
import {
  cardCaptionShowsAnything,
  createCaptionBandResolver,
  type CaptionBandAsset,
  type CardCaptionFields,
} from "./asset-caption-band";
import { FONT_SIZE_SCALES } from "./font-size-preferences";
import {
  ASSET_GRID_GAP_PX,
  countFittingColumns,
  distributeMasonryItems,
} from "./asset-grid-layout";
import {
  estimateMasonryCardBodyPx,
  layoutMasonryAssetRects,
  masonryColumnWidthPx,
  overlayLiveAssetGeometry,
  publishCanvasAssetLayout,
  stackItemHeights,
} from "./canvas-asset-layout";
import { isCanvasReflowRestorationPending } from "./canvas-reflow-restore";
import { canvasHasPreviewScrollHold } from "./browse-scroll-debug";
import { estimateMasonryPreviewHeightPx } from "./masonry-preview-frame";
import { columnWindow, useCanvasLocalViewport } from "./viewport-window";
import { useFontSize } from "./FontSizeProvider";
import type { VirtualBrowseLayout } from "./browse/virtual-browse-layout";
import { resolveBrowseCanvasLayout } from "./browse-window-slots";
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
  /** Caption toggles; every card resolves its own band from them (Serpent-b1b0f2). */
  captionFields: CardCaptionFields;
  /** A content-search snippet occupies the secondary caption line. */
  snippetLine?: boolean;
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

type MasonryColumnsBodyProps = Omit<
  MasonryColumnsProps,
  "captionFields" | "snippetLine" | "virtualLayout"
> & {
  showCaption: boolean;
  captionBandForAsset: (asset: CaptionBandAsset) => number;
};

export function MasonryColumns(props: MasonryColumnsProps) {
  const { preferences } = useFontSize();
  const fontScale = FONT_SIZE_SCALES[preferences.preference];
  const captionFields = props.captionFields;
  const snippetLine = props.snippetLine;
  const showCaption = cardCaptionShowsAnything(captionFields);
  const captionBandForAsset = useMemo(
    () =>
      createCaptionBandResolver({
        mode: "masonry",
        fields: captionFields,
        fontScale,
        snippetLine,
      }),
    [captionFields, fontScale, snippetLine],
  );
  if (props.virtualLayout) {
    return (
      <VirtualMasonryColumns
        assets={props.assets}
        layout={props.virtualLayout}
        cardSize={props.cardSize}
        showCaption={showCaption}
        captionBandForAsset={captionBandForAsset}
        renderCard={props.renderCard}
      />
    );
  }
  return (
    <RegularMasonryColumns
      assets={props.assets}
      layout={props.layout}
      cardSize={props.cardSize}
      showCaption={showCaption}
      captionBandForAsset={captionBandForAsset}
      suspendScrollRestoration={props.suspendScrollRestoration}
      renderCard={props.renderCard}
      renderLayoutPreview={props.renderLayoutPreview}
    />
  );
}

function RegularMasonryColumns({
  assets,
  layout,
  cardSize,
  showCaption,
  captionBandForAsset,
  suspendScrollRestoration = false,
  renderCard,
  renderLayoutPreview,
}: MasonryColumnsBodyProps) {
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
        if (canvasHasPreviewScrollHold(root)) {
          scrollSnapshotRef.current = null;
          rawRestoreTargetRef.current = null;
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
    const stopMeasuring = observeCanvasLayoutMeasure(element, updateWidth);
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    root?.addEventListener("scroll", cancelRawRestoreOnUserScroll, { passive: true });
    return () => {
      stopMeasuring();
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
        // Caption bands need the media type: without it the entry looks like an
        // unresolved placeholder and would reserve a resolution line the card
        // never renders.
        mediaType: asset.mediaType,
      })),
    [assets],
  );
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset])),
    [assets],
  );
  const layoutEntries = useMemo(() => {
    const source = resolveBrowseCanvasLayout(layout, assets);
    const resolved = source.length > 0 ? source : fallbackLayout;
    return overlayLiveAssetGeometry(resolved, assetById);
  }, [assetById, assets, fallbackLayout, layout]);
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
        captionBandForAsset,
      ),
    ),
    [captionBandForAsset, columnCount, columnWidth, layoutEntries, showCaption],
  );
  const layoutRects = useMemo(
    () => layoutMasonryAssetRects(
      layoutEntries,
      availableWidth,
      cardSize,
      showCaption,
      captionBandForAsset,
    ),
    [availableWidth, captionBandForAsset, cardSize, layoutEntries, showCaption],
  );
  const columnMetrics = useMemo(
    () => distributed.map((column) => ({
      bodies: column.items.map((asset) =>
        estimateMasonryCardBodyPx(
          asset,
          columnWidth,
          showCaption,
          captionBandForAsset,
        )),
      previews: column.items.map((asset) =>
        estimateMasonryPreviewHeightPx(asset.width, asset.height, columnWidth)),
    })),
    [captionBandForAsset, columnWidth, distributed, showCaption],
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
