import { describe, expect, it } from "vitest";

import {
  AssetThumbnailPatchQueue,
  DeferredVersionedThumbnailPatches,
  resolveQueuedAssetThumbnailPatches,
} from "../../src/renderer/asset-thumbnail-patch-queue";
import type { AssetSummary } from "../../src/shared/asset-types";

function asset(assetId: string, currentRevisionId = `revision-${assetId}`): AssetSummary {
  return {
    assetId,
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath: `${assetId}.png`,
    displayName: `${assetId}.png`,
    currentRevisionId,
    byteSize: 100,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: "pending",
    thumbnailArtifactId: null,
    mediaType: "image",
    width: null,
    height: null,
    durationMs: null,
  };
}

describe("AssetThumbnailPatchQueue", () => {
  it("drops an old revision patch when its asset loads before the frame is resolved", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("asset-a", { width: 640, height: 480 }, "revision-r1");
    const snapshot = queue.drain();

    expect(resolveQueuedAssetThumbnailPatches(snapshot, [asset("asset-a", "revision-r1")]))
      .toEqual(new Map([["asset-a", { width: 640, height: 480 }]]));
    expect(resolveQueuedAssetThumbnailPatches(snapshot, [asset("asset-a", "revision-r2")]))
      .toEqual(new Map());
    expect(snapshot.get("asset-a")).toEqual([{
      patch: { width: 640, height: 480 },
      expectedRevisionId: "revision-r1",
    }]);
  });

  it("preserves an unversioned new thumbnail when a versioned old dimension group is stale", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("asset-a", { width: 640, height: 480 }, "revision-r1");
    queue.enqueue("asset-a", {
      thumbnailStatus: "ready",
      thumbnailArtifactId: "thumbnail-r2",
    });
    queue.enqueue("asset-a", { previewKind: "source" }, "revision-r1");
    const snapshot = queue.drain();

    expect(snapshot.get("asset-a")).toHaveLength(3);
    expect(resolveQueuedAssetThumbnailPatches(snapshot, [asset("asset-a", "revision-r2")]))
      .toEqual(new Map([[
        "asset-a",
        { thumbnailStatus: "ready", thumbnailArtifactId: "thumbnail-r2" },
      ]]));
  });

  it("applies a current revision measurement normally", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("asset-a", {
      width: 640,
      height: 480,
      previewKind: "source",
      previewRevisionId: "revision-r2",
    }, "revision-r2");

    expect(resolveQueuedAssetThumbnailPatches(queue.drain(), [asset("asset-a", "revision-r2")]))
      .toEqual(new Map([[
        "asset-a",
        {
          width: 640,
          height: 480,
          previewKind: "source",
          previewRevisionId: "revision-r2",
        },
      ]]));
  });

  it("keeps groups for different revisions separate and resolves only the current one", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("asset-a", { width: 640 }, "revision-r1");
    queue.enqueue("asset-a", { height: 480 }, "revision-r2");
    const snapshot = queue.drain();

    expect(snapshot.get("asset-a")).toEqual([
      { patch: { width: 640 }, expectedRevisionId: "revision-r1" },
      { patch: { height: 480 }, expectedRevisionId: "revision-r2" },
    ]);
    expect(resolveQueuedAssetThumbnailPatches(snapshot, [asset("asset-a", "revision-r1")]))
      .toEqual(new Map([["asset-a", { width: 640 }]]));
    expect(resolveQueuedAssetThumbnailPatches(snapshot, [asset("asset-a", "revision-r2")]))
      .toEqual(new Map([["asset-a", { height: 480 }]]));
  });

  it("merges adjacent groups with the same revision while keeping ordinary unguarded patches", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("versioned", { width: 640 }, "revision-a");
    queue.enqueue("versioned", { height: 480 }, "revision-a");
    queue.enqueue("legacy", { thumbnailStatus: "ready" });
    queue.enqueue("legacy", { thumbnailArtifactId: "thumbnail-legacy" });
    const snapshot = queue.drain();

    expect(snapshot.get("versioned")).toEqual([{
      patch: { width: 640, height: 480 },
      expectedRevisionId: "revision-a",
    }]);
    expect(snapshot.get("legacy")).toEqual([{
      patch: { thumbnailStatus: "ready", thumbnailArtifactId: "thumbnail-legacy" },
    }]);
    expect(resolveQueuedAssetThumbnailPatches(snapshot, [
      asset("versioned", "revision-a"),
      asset("legacy"),
    ])).toEqual(new Map([
      ["versioned", { width: 640, height: 480 }],
      ["legacy", { thumbnailStatus: "ready", thumbnailArtifactId: "thumbnail-legacy" }],
    ]));
  });

  it("allows only geometry from an unknown versioned patch and preserves unguarded patches", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("geometry-only", {
      width: 640,
      height: 480,
      previewKind: "source",
      previewRevisionId: "revision-r1",
      thumbnailStatus: "ready",
    }, "revision-r1");
    queue.enqueue("unversioned", {
      previewKind: "source",
      previewRevisionId: "legacy-revision",
      thumbnailArtifactId: "legacy-thumbnail",
    });
    queue.enqueue("versioned-route-only", {
      previewKind: "source",
      previewRevisionId: "revision-r1",
    }, "revision-r1");

    expect(resolveQueuedAssetThumbnailPatches(queue.drain(), [])).toEqual(new Map([
      ["geometry-only", { width: 640, height: 480 }],
      ["unversioned", {
        previewKind: "source",
        previewRevisionId: "legacy-revision",
        thumbnailArtifactId: "legacy-thumbnail",
      }],
    ]));
  });

  it("keeps drained snapshots isolated from later enqueues and supports size and clear", () => {
    const queue = new AssetThumbnailPatchQueue();
    queue.enqueue("asset-a", { width: 640 }, "revision-a");
    queue.enqueue("asset-a", { height: 480 }, "revision-a");
    queue.enqueue("asset-b", { thumbnailStatus: "ready" });
    expect(queue.size).toBe(2);

    const snapshot = queue.drain();
    expect(queue.size).toBe(0);
    queue.enqueue("asset-a", { thumbnailArtifactId: "thumbnail-a" }, "revision-a");
    expect(snapshot.get("asset-a")).toEqual([{
      patch: { width: 640, height: 480 },
      expectedRevisionId: "revision-a",
    }]);
    expect(queue.drain().get("asset-a")).toEqual([{
      patch: { thumbnailArtifactId: "thumbnail-a" },
      expectedRevisionId: "revision-a",
    }]);

    queue.enqueue("asset-c", { width: 320 }, "revision-c");
    queue.clear();
    expect(queue.size).toBe(0);
    expect(queue.drain()).toEqual(new Map());
  });
});

describe("DeferredVersionedThumbnailPatches", () => {
  it("replays a cached source-direct route when its matching summary arrives", () => {
    const deferred = new DeferredVersionedThumbnailPatches();
    const patch = {
      width: 640,
      height: 480,
      previewKind: "source" as const,
      previewRevisionId: "revision-r1",
    };
    deferred.remember("asset-a", patch, "revision-r1");

    expect(deferred.takeFor([])).toEqual([]);
    expect(deferred.size).toBe(1);
    expect(deferred.takeFor([asset("asset-a", "revision-r1")])).toEqual([
      { assetId: "asset-a", patch, expectedRevisionId: "revision-r1" },
    ]);
    expect(deferred.size).toBe(0);
    deferred.remember("asset-a", { width: 320, height: 240 }, "revision-r2");
    deferred.clear();
    expect(deferred.size).toBe(0);
  });

  it("keeps the matching revision when a late older revision is remembered", () => {
    const deferred = new DeferredVersionedThumbnailPatches();
    deferred.remember("asset-a", {
      width: 800,
      height: 600,
      previewKind: "source",
      previewRevisionId: "revision-r2",
    }, "revision-r2");
    deferred.remember("asset-a", {
      width: 320,
      height: 240,
      previewKind: "source",
      previewRevisionId: "revision-r1",
    }, "revision-r1");

    expect(deferred.takeFor([asset("asset-a", "revision-r2")])).toEqual([{
      assetId: "asset-a",
      patch: {
        width: 800,
        height: 600,
        previewKind: "source",
        previewRevisionId: "revision-r2",
      },
      expectedRevisionId: "revision-r2",
    }]);
    expect(deferred.size).toBe(0);
  });

  it("discards facts for a known asset whose current revision does not match", () => {
    const deferred = new DeferredVersionedThumbnailPatches();
    deferred.remember("asset-a", { width: 640, height: 480 }, "revision-r1");

    expect(deferred.takeFor([asset("asset-a", "revision-r2")])).toEqual([]);
    expect(deferred.size).toBe(0);
  });

  it("merges facts by asset and revision and evicts the least-recently-used fact", () => {
    const deferred = new DeferredVersionedThumbnailPatches(2);
    deferred.remember("asset-a", { width: 640 }, "revision-a");
    deferred.remember("asset-b", { width: 320 }, "revision-b");
    deferred.remember("asset-a", { height: 480 }, "revision-a");
    deferred.remember("asset-c", { width: 800 }, "revision-c");
    expect(deferred.size).toBe(2);

    expect(deferred.takeFor([
      asset("asset-a", "revision-a"),
      asset("asset-b", "revision-b"),
      asset("asset-c", "revision-c"),
    ])).toEqual([
      {
        assetId: "asset-a",
        patch: { width: 640, height: 480 },
        expectedRevisionId: "revision-a",
      },
      {
        assetId: "asset-c",
        patch: { width: 800 },
        expectedRevisionId: "revision-c",
      },
    ]);
  });

  it("requires a positive integer entry limit", () => {
    expect(() => new DeferredVersionedThumbnailPatches(0)).toThrow(RangeError);
    expect(() => new DeferredVersionedThumbnailPatches(1.5)).toThrow(RangeError);
  });
});
