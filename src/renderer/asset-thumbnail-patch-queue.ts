import type { AssetSummary } from "../shared/asset-types";
import {
  mergeAssetThumbnailPatch,
  type AssetThumbnailPatch,
} from "./asset-thumbnail-patches";

export type QueuedAssetThumbnailPatchGroup = {
  patch: AssetThumbnailPatch;
  expectedRevisionId?: string;
};

export type AssetThumbnailPatchQueueSnapshot = ReadonlyMap<
  string,
  readonly QueuedAssetThumbnailPatchGroup[]
>;

/** Frame-batched patch groups, keeping revision guards separate and ordered. */
export class AssetThumbnailPatchQueue {
  #groupsByAssetId = new Map<string, QueuedAssetThumbnailPatchGroup[]>();

  get size(): number {
    return this.#groupsByAssetId.size;
  }

  enqueue(
    assetId: string,
    patch: AssetThumbnailPatch,
    expectedRevisionId?: string,
  ): void {
    const groups = this.#groupsByAssetId.get(assetId) ?? [];
    const last = groups.at(-1);
    let nextGroups: QueuedAssetThumbnailPatchGroup[];

    if (last && last.expectedRevisionId === expectedRevisionId) {
      const mergedGroup: QueuedAssetThumbnailPatchGroup = {
        patch: mergeAssetThumbnailPatch(last.patch, patch),
        ...(expectedRevisionId === undefined ? {} : { expectedRevisionId }),
      };
      nextGroups = [...groups.slice(0, -1), mergedGroup];
    } else {
      nextGroups = [
        ...groups,
        {
          patch: { ...patch },
          ...(expectedRevisionId === undefined ? {} : { expectedRevisionId }),
        },
      ];
    }

    this.#groupsByAssetId.set(assetId, nextGroups);
  }

  clear(): void {
    this.#groupsByAssetId.clear();
  }

  drain(): AssetThumbnailPatchQueueSnapshot {
    const snapshot = new Map<string, readonly QueuedAssetThumbnailPatchGroup[]>();
    for (const [assetId, groups] of this.#groupsByAssetId) {
      snapshot.set(assetId, groups.map((group) => ({
        patch: { ...group.patch },
        ...(group.expectedRevisionId === undefined
          ? {}
          : { expectedRevisionId: group.expectedRevisionId }),
      })));
    }
    this.#groupsByAssetId = new Map();
    return snapshot;
  }
}

/** Resolve a drained frame against the summary revision that exists at apply time. */
export function resolveQueuedAssetThumbnailPatches(
  snapshot: AssetThumbnailPatchQueueSnapshot,
  assets: readonly AssetSummary[],
): Map<string, AssetThumbnailPatch> {
  const currentById = new Map(assets.map((asset) => [asset.assetId, asset] as const));
  const resolved = new Map<string, AssetThumbnailPatch>();

  for (const [assetId, groups] of snapshot) {
    const current = currentById.get(assetId);
    let patch: AssetThumbnailPatch | undefined;
    for (const group of groups) {
      if (
        current
        && group.expectedRevisionId !== undefined
        && group.expectedRevisionId !== current.currentRevisionId
      ) continue;
      if (!current && group.expectedRevisionId !== undefined) {
        const geometryPatch: AssetThumbnailPatch = {
          ...(group.patch.width === undefined ? {} : { width: group.patch.width }),
          ...(group.patch.height === undefined ? {} : { height: group.patch.height }),
        };
        if (geometryPatch.width === undefined && geometryPatch.height === undefined) continue;
        patch = mergeAssetThumbnailPatch(patch, geometryPatch);
      } else {
        patch = mergeAssetThumbnailPatch(patch, group.patch);
      }
    }
    if (patch !== undefined) resolved.set(assetId, patch);
  }

  return resolved;
}

type DeferredVersionedThumbnailPatch = {
  assetId: string;
  expectedRevisionId: string;
  patch: AssetThumbnailPatch;
};

/** Small owner-scoped cache for full versioned patches whose summaries are not loaded yet. */
export class DeferredVersionedThumbnailPatches {
  readonly #limit: number;
  readonly #factsByRevision = new Map<string, DeferredVersionedThumbnailPatch>();

  constructor(limit = 512) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("Deferred versioned thumbnail patch limit must be a positive integer.");
    }
    this.#limit = limit;
  }

  get size(): number {
    return this.#factsByRevision.size;
  }

  remember(
    assetId: string,
    patch: AssetThumbnailPatch,
    expectedRevisionId: string,
  ): void {
    const key = JSON.stringify([assetId, expectedRevisionId]);
    const previous = this.#factsByRevision.get(key);
    this.#factsByRevision.delete(key);
    this.#factsByRevision.set(key, {
      assetId,
      expectedRevisionId,
      patch: mergeAssetThumbnailPatch(previous?.patch, patch),
    });
    while (this.#factsByRevision.size > this.#limit) {
      const oldestKey = this.#factsByRevision.keys().next().value;
      if (oldestKey === undefined) break;
      this.#factsByRevision.delete(oldestKey);
    }
  }

  takeFor(assets: readonly AssetSummary[]): Array<{
    assetId: string;
    patch: AssetThumbnailPatch;
    expectedRevisionId: string;
  }> {
    if (assets.length === 0 || this.#factsByRevision.size === 0) return [];
    const currentById = new Map(assets.map((asset) => [asset.assetId, asset] as const));
    const taken: Array<{
      assetId: string;
      patch: AssetThumbnailPatch;
      expectedRevisionId: string;
    }> = [];

    for (const [key, fact] of this.#factsByRevision) {
      const current = currentById.get(fact.assetId);
      if (!current) continue;
      this.#factsByRevision.delete(key);
      if (current.currentRevisionId !== fact.expectedRevisionId) continue;
      taken.push({
        assetId: fact.assetId,
        patch: { ...fact.patch },
        expectedRevisionId: fact.expectedRevisionId,
      });
    }
    return taken;
  }

  clear(): void {
    this.#factsByRevision.clear();
  }
}
