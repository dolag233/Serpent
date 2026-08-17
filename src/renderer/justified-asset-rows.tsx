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
  ASSET_GRID_GAP_PX,
  aspectRatioForAsset,
  layoutJustifiedRows,
  type JustifiedPlacement,
} from "./asset-grid-layout";
import {
  layoutJustifiedAssetRects,
  publishCanvasAssetLayout,
  stackItemHeights,
} from "./canvas-asset-layout";
import { resolveJustifiedCaptionBandPx } from "./justified-caption-band";
import { columnWindow, useCanvasLocalViewport } from "./viewport-window";

export {
  resolveJustifiedCaptionBandPx,
  type JustifiedCaptionLines,
} from "./justified-caption-band";

/** @deprecated Caption no longer flex-couples to preview height (Serpent-5p45). */
export const JUSTIFIED_CAPTION_BAND_PX = resolveJustifiedCaptionBandPx({
  dimensions: true,
  name: true,
  secondary: true,
});

/**
 * Slot geometry for one justified placement.
 * Preview height is an explicit CSS variable so caption text can never
 * flex-shrink the media box (Serpent-omn / Serpent-5p45).
 */
export function justifiedSlotStyle(
  placement: JustifiedPlacement,
): CSSProperties {
  return {
    width: Math.max(1, Math.round(placement.width)),
    ["--justified-preview-height" as string]: `${Math.max(1, Math.round(placement.height))}px`,
  };
}

export function JustifiedAssetRows({
  assets,
  layout,
  cardSize,
  renderCard,
  renderLayoutPreview,
}: {
  assets: AssetSummary[];
  layout: BrowseLayoutEntry[];
  cardSize: number;
  renderCard: (asset: AssetSummary) => ReactNode;
  renderLayoutPreview?: (entry: BrowseLayoutEntry) => ReactNode;
  /**
   * @deprecated Ignored. Preview height is locked to layout placement;
   * caption renders at natural height below (Serpent-5p45).
   */
  captionBandPx?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const viewport = useCanvasLocalViewport(containerRef, cardSize);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
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
  const layoutEntries = layout.length > 0 ? layout : fallbackLayout;
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset] as const)),
    [assets],
  );
  const layoutById = useMemo(
    () => new Map(layoutEntries.map((entry) => [entry.assetId, entry] as const)),
    [layoutEntries],
  );
  const rows = useMemo(
    () => layoutJustifiedRows(
      layoutEntries.map((asset) => ({
        id: asset.assetId,
        aspectRatio: aspectRatioForAsset(asset.width, asset.height),
      })),
      availableWidth,
      cardSize,
      ASSET_GRID_GAP_PX,
    ),
    [availableWidth, cardSize, layoutEntries],
  );
  const captionBandPx = JUSTIFIED_CAPTION_BAND_PX;
  const layoutRects = useMemo(
    () => layoutJustifiedAssetRects(
      layoutEntries,
      availableWidth,
      cardSize,
      captionBandPx,
    ),
    [availableWidth, captionBandPx, cardSize, layoutEntries],
  );
  const rowBodies = useMemo(
    () => rows.map((row) => row.height + captionBandPx),
    [captionBandPx, rows],
  );
  const rowWindow = columnWindow(
    stackItemHeights(rowBodies),
    viewport.start,
    viewport.end,
  );

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    publishCanvasAssetLayout(element, layoutRects);
  }, [layoutRects]);

  return (
    <div
      className="justified-rows"
      ref={containerRef}
      style={{ gap: 0, minHeight: rowWindow.totalHeight }}
    >
      {rowWindow.spacerBefore > 0 ? (
        <div
          aria-hidden
          style={{ height: rowWindow.spacerBefore, flexShrink: 0 }}
        />
      ) : null}
      {rows.slice(rowWindow.start, rowWindow.end).map((row, offset) => {
        const rowIndex = rowWindow.start + offset;
        const isLast = rowIndex === rows.length - 1;
        return (
          <div
            className="justified-row"
            key={`justified-row-${rowIndex}`}
            style={isLast ? undefined : { marginBottom: ASSET_GRID_GAP_PX }}
          >
            {row.items.map((placement) => {
              const asset = assetById.get(placement.id);
              const layoutEntry = layoutById.get(placement.id)!;
              return (
                <div
                  aria-hidden={asset ? undefined : true}
                  className="justified-card-slot"
                  data-layout-asset-id={placement.id}
                  key={placement.id}
                  style={justifiedSlotStyle(placement)}
                >
                  {asset ? renderCard(asset) : renderLayoutPreview?.(layoutEntry)}
                </div>
              );
            })}
          </div>
        );
      })}
      {rowWindow.spacerAfter > 0 ? (
        <div
          aria-hidden
          style={{ height: rowWindow.spacerAfter, flexShrink: 0 }}
        />
      ) : null}
    </div>
  );
}
