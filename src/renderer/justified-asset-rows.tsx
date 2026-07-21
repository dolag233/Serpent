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
import { resolveJustifiedCaptionBandPx } from "./justified-caption-band";

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
  children,
}: {
  assets: AssetSummary[];
  cardSize: number;
  children: ReactNode[];
  /**
   * @deprecated Ignored. Preview height is locked to layout placement;
   * caption renders at natural height below (Serpent-5p45).
   */
  captionBandPx?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateWidth = () => setAvailableWidth(element.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const childById = new Map(
    assets.map((asset, index) => [asset.assetId, children[index]] as const),
  );
  const rows = layoutJustifiedRows(
    assets.map((asset) => ({
      id: asset.assetId,
      aspectRatio: aspectRatioForAsset(asset.width, asset.height),
    })),
    availableWidth,
    cardSize,
    ASSET_GRID_GAP_PX,
  );

  return (
    <div className="justified-rows" ref={containerRef}>
      {rows.map((row, rowIndex) => (
        <div
          className="justified-row"
          key={`justified-row-${rowIndex}`}
        >
          {row.items.map((placement) => (
            <div
              className="justified-card-slot"
              key={placement.id}
              style={justifiedSlotStyle(placement)}
            >
              {childById.get(placement.id)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
