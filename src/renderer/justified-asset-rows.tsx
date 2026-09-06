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
  aspectRatioForAsset,
  layoutJustifiedRows,
  type JustifiedPlacement,
} from "./asset-grid-layout";
import {
  layoutJustifiedAssetRects,
  overlayLiveAssetGeometry,
  publishCanvasAssetLayout,
  stackItemHeights,
} from "./canvas-asset-layout";
import {
  resolveJustifiedCaptionBandPx,
} from "./justified-caption-band";
import { useFontSize } from "./FontSizeProvider";
import { columnWindow, useCanvasLocalViewport } from "./viewport-window";
import type { VirtualBrowseLayout } from "./browse/virtual-browse-layout";
import {
  VirtualJustifiedAssetRows,
  virtualJustifiedRowStyle,
  type BrowseCardRenderOptions,
} from "./browse/virtual-browse-canvas";

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

type JustifiedAssetRowsProps = {
  assets: AssetSummary[];
  layout: BrowseLayoutEntry[];
  virtualLayout?: VirtualBrowseLayout | null;
  cardSize: number;
  renderCard: (
    asset: AssetSummary,
    options?: BrowseCardRenderOptions,
  ) => ReactNode;
  renderLayoutPreview?: (
    entry: BrowseLayoutEntry,
    options?: BrowseCardRenderOptions,
  ) => ReactNode;
  /** @deprecated Ignored. Preview height is locked to layout placement. */
  captionBandPx?: number;
};

export function JustifiedAssetRows(props: JustifiedAssetRowsProps) {
  const { preferences } = useFontSize();
  const captionBandPx = resolveJustifiedCaptionBandPx(
    {
      dimensions: true,
      name: true,
      secondary: true,
    },
    FONT_SIZE_SCALES[preferences.preference],
  );
  if (props.virtualLayout) {
    return (
      <VirtualJustifiedAssetRows
        assets={props.assets}
        layout={props.virtualLayout}
        cardSize={props.cardSize}
        captionBandPx={captionBandPx}
        renderCard={props.renderCard}
        renderLayoutPreview={props.renderLayoutPreview}
      />
    );
  }
  return <RegularJustifiedAssetRows {...props} captionBandPx={captionBandPx} />;
}

function RegularJustifiedAssetRows({
  assets,
  layout,
  cardSize,
  renderCard,
  renderLayoutPreview,
  captionBandPx = JUSTIFIED_CAPTION_BAND_PX,
}: JustifiedAssetRowsProps) {
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
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.assetId, asset] as const)),
    [assets],
  );
  const layoutEntries = useMemo(() => {
    const source = layout.length > 0 ? layout : fallbackLayout;
    return overlayLiveAssetGeometry(source, assetById);
  }, [assetById, fallbackLayout, layout]);
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
      style={{
        gap: 0,
        minHeight: rowWindow.totalHeight,
        ["--justified-caption-band" as string]: `${captionBandPx}px`,
      }}
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
            style={virtualJustifiedRowStyle({
              bodyHeightPx: row.height + captionBandPx,
              isLast,
            })}
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
