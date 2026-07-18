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

/** Fixed caption band under the preview so row image heights stay aligned. */
export const JUSTIFIED_CAPTION_BAND_PX = 22;

export function JustifiedAssetRows({
  assets,
  cardSize,
  children,
  showCaptionBand,
}: {
  assets: AssetSummary[];
  cardSize: number;
  children: ReactNode[];
  showCaptionBand: boolean;
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
          style={{
            height: row.height + (showCaptionBand ? JUSTIFIED_CAPTION_BAND_PX : 0),
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
