import type { AssetSummary } from "../shared/asset-types";

export type AssetThumbnailPatch = {
  thumbnailStatus?: AssetSummary["thumbnailStatus"];
  thumbnailArtifactId?: string | null;
  previewKind?: "source" | null;
  previewRevisionId?: string | null;
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
    const directChanged = direct !== undefined && (
      (direct.thumbnailStatus !== undefined && direct.thumbnailStatus !== asset.thumbnailStatus)
      || (direct.thumbnailArtifactId !== undefined && direct.thumbnailArtifactId !== asset.thumbnailArtifactId)
      || (direct.previewKind !== undefined && direct.previewKind !== asset.previewKind)
      || (direct.previewRevisionId !== undefined && direct.previewRevisionId !== asset.previewRevisionId)
      || (direct.width !== undefined && direct.width !== asset.width)
      || (direct.height !== undefined && direct.height !== asset.height)
      || (direct.durationMs !== undefined && direct.durationMs !== asset.durationMs)
    );
    if (directChanged && direct) {
      item = {
        ...asset,
        ...(direct.thumbnailStatus === undefined ? {} : { thumbnailStatus: direct.thumbnailStatus }),
        ...(direct.thumbnailArtifactId === undefined ? {} : { thumbnailArtifactId: direct.thumbnailArtifactId }),
        ...(direct.previewKind === undefined ? {} : { previewKind: direct.previewKind }),
        ...(direct.previewRevisionId === undefined ? {} : { previewRevisionId: direct.previewRevisionId }),
        ...(direct.width === undefined ? {} : { width: direct.width }),
        ...(direct.height === undefined ? {} : { height: direct.height }),
        ...(direct.durationMs === undefined ? {} : { durationMs: direct.durationMs }),
      };
    }

    if (!asset.sequence) {
      if (item !== asset) changed = true;
      return item;
    }

    let frames: typeof asset.sequence.frames | undefined;
    for (let frameIndex = 0; frameIndex < asset.sequence.frames.length; frameIndex += 1) {
      const frame = asset.sequence.frames[frameIndex]!;
      const framePatch = patches.get(frame.assetId);
      if (
        !framePatch?.sequenceFrameArtifactId
        || framePatch.sequenceFrameArtifactId === frame.thumbnailArtifactId
      ) continue;
      frames ??= [...asset.sequence.frames];
      frames[frameIndex] = {
        ...frame,
        thumbnailArtifactId: framePatch.sequenceFrameArtifactId,
      };
    }
    if (!frames) {
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

export class AssetDimensionPublicationTracker {
  readonly #limit: number;
  readonly #lastPublishedByAssetId = new Map<string, {
    revisionId: string;
    mediaType: AssetSummary["mediaType"];
    width: number;
    height: number;
  }>();

  constructor(limit = 512) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("Asset dimension publication tracker limit must be a positive integer.");
    }
    this.#limit = limit;
  }

  collect(
    assets: readonly AssetSummary[],
    patches: ReadonlyMap<string, AssetThumbnailPatch>,
  ): Array<{
    assetId: string;
    width: number;
    height: number;
    mediaType: AssetSummary["mediaType"];
  }> {
    if (patches.size === 0 || assets.length === 0) return [];
    const assetsById = new Map(assets.map((asset) => [asset.assetId, asset] as const));
    const published: Array<{
      assetId: string;
      width: number;
      height: number;
      mediaType: AssetSummary["mediaType"];
    }> = [];

    for (const [assetId, patch] of patches) {
      const asset = assetsById.get(assetId);
      const { width, height } = patch;
      if (
        !asset
        || typeof width !== "number"
        || !Number.isFinite(width)
        || width <= 0
        || typeof height !== "number"
        || !Number.isFinite(height)
        || height <= 0
      ) continue;

      const previous = this.#lastPublishedByAssetId.get(assetId);
      const duplicate = previous?.revisionId === asset.currentRevisionId
        && previous.mediaType === asset.mediaType
        && previous.width === width
        && previous.height === height;
      this.#lastPublishedByAssetId.delete(assetId);
      this.#lastPublishedByAssetId.set(assetId, {
        revisionId: asset.currentRevisionId,
        mediaType: asset.mediaType,
        width,
        height,
      });
      while (this.#lastPublishedByAssetId.size > this.#limit) {
        const oldestAssetId = this.#lastPublishedByAssetId.keys().next().value;
        if (oldestAssetId === undefined) break;
        this.#lastPublishedByAssetId.delete(oldestAssetId);
      }

      if (!duplicate) published.push({ assetId, width, height, mediaType: asset.mediaType });
    }
    return published;
  }
}

export function mergeAssetThumbnailPatch(
  current: AssetThumbnailPatch | undefined,
  incoming: AssetThumbnailPatch,
): AssetThumbnailPatch {
  return { ...current, ...incoming };
}
