import type { AssetSummary } from "../shared/asset-types";

export type AssetThumbnailPatch = {
  thumbnailStatus?: AssetSummary["thumbnailStatus"];
  thumbnailArtifactId?: string | null;
  width?: number;
  height?: number;
  durationMs?: number;
  sequenceFrameArtifactId?: string;
};

export function applyAssetThumbnailPatches(
  assets: readonly AssetSummary[],
  patches: ReadonlyMap<string, AssetThumbnailPatch>,
): AssetSummary[] {
  if (patches.size === 0) return assets as AssetSummary[];

  let changed = false;
  const next = assets.map((asset) => {
    const direct = patches.get(asset.assetId);
    let item = asset;
    if (direct) {
      item = {
        ...asset,
        ...(direct.thumbnailStatus === undefined
          ? {}
          : { thumbnailStatus: direct.thumbnailStatus }),
        ...(direct.thumbnailArtifactId === undefined
          ? {}
          : { thumbnailArtifactId: direct.thumbnailArtifactId }),
        ...(direct.width === undefined ? {} : { width: direct.width }),
        ...(direct.height === undefined ? {} : { height: direct.height }),
        ...(direct.durationMs === undefined
          ? {}
          : { durationMs: direct.durationMs }),
      };
    }

    if (!asset.sequence) {
      if (item !== asset) changed = true;
      return item;
    }

    let framesChanged = false;
    const frames = asset.sequence.frames.map((frame) => {
      const framePatch = patches.get(frame.assetId);
      if (!framePatch?.sequenceFrameArtifactId) return frame;
      framesChanged = true;
      return {
        ...frame,
        thumbnailArtifactId: framePatch.sequenceFrameArtifactId,
      };
    });
    if (!framesChanged) {
      if (item !== asset) changed = true;
      return item;
    }
    changed = true;
    return {
      ...item,
      sequence: { ...asset.sequence, frames },
    };
  });

  return changed ? next : (assets as AssetSummary[]);
}

export function mergeAssetThumbnailPatch(
  current: AssetThumbnailPatch | undefined,
  incoming: AssetThumbnailPatch,
): AssetThumbnailPatch {
  return { ...current, ...incoming };
}
