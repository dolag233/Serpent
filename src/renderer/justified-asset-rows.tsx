import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { AssetSummary } from "../shared/asset-types";
import {
  ASSET_GRID_GAP_PX,
  aspectRatioForAsset,
  layoutJustifiedRows,
} from "./asset-grid-layout";
import { resolveJustifiedCaptionBandPx } from "./justified-caption-band";

export {
  resolveJustifiedCaptionBandPx,
  type JustifiedCaptionLines,
} from "./justified-caption-band";

/** @deprecated Use resolveJustifiedCaptionBandPx — kept for call-site discovery. */
export const JUSTIFIED_CAPTION_BAND_PX = resolveJustifiedCaptionBandPx({
  dimensions: true,
  name: true,
  secondary: true,
});

export function JustifiedAssetRows({
  assets,
  cardSize,
  children,
  captionBandPx,
}: {
  assets: AssetSummary[];
  cardSize: number;
  children: ReactNode[];
  /** Reserved height under the image row; must match rendered caption. */
  captionBandPx: number;
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
  const bandPx = Math.max(0, Math.round(captionBandPx));

  return (
    <div className="justified-rows" ref={containerRef}>
      {rows.map((row, rowIndex) => (
        <div
          className="justified-row"
          key={`justified-row-${rowIndex}`}
          style={{
            height: row.height + bandPx,
          }}
        >
          {row.items.map((placement) => (
            <div
              className="justified-card-slot"
              key={placement.id}
              style={{
                width: placement.width,
                height: "100%",
              }}
            >
              {childById.get(placement.id)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
