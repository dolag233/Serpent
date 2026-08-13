import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AssetSummary } from "../shared/asset-types";
import {
  ASSET_GRID_GAP_PX,
  countFittingColumns,
  distributeMasonryItems,
} from "./asset-grid-layout";
import {
  estimateMasonryCardBodyPx,
  layoutMasonryAssetRects,
  masonryColumnWidthPx,
  publishCanvasAssetLayout,
  stackItemHeights,
} from "./canvas-asset-layout";
import { isCanvasReflowRestorationPending } from "./canvas-reflow-restore";
import { columnWindow, useCanvasLocalViewport } from "./viewport-window";

export function MasonryColumns({
  assets,
  cardSize,
  showCaption,
  suspendScrollRestoration = false,
  renderCard,
}: {
  assets: AssetSummary[];
  cardSize: number;
  showCaption: boolean;
  suspendScrollRestoration?: boolean;
  renderCard: (asset: AssetSummary) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const availableWidthRef = useRef(0);
  const restoreFrameRef = useRef<number | null>(null);
  const scrollSnapshotRef = useRef<number | null>(null);
  const rawRestoreTargetRef = useRef<number | null>(null);
  const suspendScrollRestorationRef = useRef(suspendScrollRestoration);
  const viewport = useCanvasLocalViewport(containerRef);

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

  const columnCount = countFittingColumns(availableWidth, cardSize);
  const columnWidth = masonryColumnWidthPx(availableWidth, columnCount);
  const distributed = distributeMasonryItems(
    assets,
    columnCount,
    (asset) => estimateMasonryCardBodyPx(asset, columnWidth, showCaption),
  );
  const layoutRects = layoutMasonryAssetRects(
    assets,
    availableWidth,
    cardSize,
    showCaption,
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
        const bodies = column.items.map((asset) =>
          estimateMasonryCardBodyPx(asset, columnWidth, showCaption),
        );
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
            {column.items.slice(visibleWindow.start, visibleWindow.end).map((asset, offset) => {
              const itemIndex = visibleWindow.start + offset;
              const isLast = itemIndex === column.items.length - 1;
              return (
                <div
                  className="masonry-card-slot"
                  key={asset.assetId}
                  style={
                    isLast ? undefined : { marginBottom: ASSET_GRID_GAP_PX }
                  }
                >
                  {renderCard(asset)}
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
