import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import type { AssetSummary } from "../shared/asset-types";
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
    width: placement.width,
    ["--justified-preview-height" as string]: `${Math.max(1, placement.height)}px`,
  };
}

export function JustifiedAssetRows({
  assets,
  cardSize,
  renderCard,
}: {
  assets: AssetSummary[];
  cardSize: number;
  renderCard: (asset: AssetSummary) => ReactNode;
  /**
   * @deprecated Ignored. Preview height is locked to layout placement;
   * caption renders at natural height below (Serpent-5p45).
   */
  captionBandPx?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const viewport = useCanvasLocalViewport(containerRef);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const assetById = new Map(assets.map((asset) => [asset.assetId, asset] as const));
  const rows = layoutJustifiedRows(
    assets.map((asset) => ({
      id: asset.assetId,
      aspectRatio: aspectRatioForAsset(asset.width, asset.height),
    })),
    availableWidth,
    cardSize,
    ASSET_GRID_GAP_PX,
  );
  const captionBandPx = JUSTIFIED_CAPTION_BAND_PX;
  const layoutRects = layoutJustifiedAssetRects(
    assets,
    availableWidth,
    cardSize,
    captionBandPx,
  );
  const rowBodies = rows.map((row) => row.height + captionBandPx);
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
              if (!asset) return null;
              return (
                <div
                  className="justified-card-slot"
                  key={placement.id}
                  style={justifiedSlotStyle(placement)}
                >
                  {renderCard(asset)}
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
