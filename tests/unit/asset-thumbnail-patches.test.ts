import { describe, expect, it } from "vitest";

import {
  AssetDimensionPublicationTracker,
  applyAssetThumbnailPatches,
} from "../../src/renderer/asset-thumbnail-patches";
import type { AssetSummary } from "../../src/shared/asset-types";

function asset(id: string, extra: Partial<AssetSummary> = {}): AssetSummary {
  return {
    assetId: id,
    locationKind: "linked",
    managedFolderId: null,
    relativeFilePath: `${id}.jpg`,
    displayName: `${id}.jpg`,
    currentRevisionId: `rev-${id}`,
    byteSize: 12,
    modifiedAt: "2026-08-13T00:00:00.000Z",
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
    ...extra,
  };
}

function sequenceAsset(): AssetSummary {
  const frames: NonNullable<AssetSummary["sequence"]>["frames"] = [0, 1, 2].map(
    (frameNumber) => ({
      assetId: `frame-${frameNumber}`,
      displayName: `frame-${frameNumber}.png`,
      relativeFilePath: `frame-${frameNumber}.png`,
      currentRevisionId: `rev-frame-${frameNumber}`,
      frameNumber,
      thumbnailArtifactId: `artifact-frame-${frameNumber}`,
    }),
  );
  return asset("sequence", {
    thumbnailStatus: "ready",
    thumbnailArtifactId: "artifact-sequence",
    previewKind: "source",
    previewRevisionId: "rev-sequence",
    width: 640,
    height: 480,
    durationMs: 120,
    sequence: {
      sequenceId: "sequence-1",
      fps: 24,
      frameCount: frames.length,
      frames,
    },
  });
}

describe("applyAssetThumbnailPatches", () => {
  it("returns the same array when no patch applies", () => {
    const assets = [asset("a"), asset("b")];
    expect(applyAssetThumbnailPatches(assets, new Map())).toBe(assets);
    expect(
      applyAssetThumbnailPatches(assets, new Map([["z", { width: 10 }]])),
    ).toBe(assets);
  });

  it("keeps the same references when direct and sequence-frame values are unchanged", () => {
    const sequence = sequenceAsset();
    const assets = [sequence];
    const frame = sequence.sequence!.frames[1]!;
    const next = applyAssetThumbnailPatches(assets, new Map([
      ["sequence", {
        thumbnailStatus: "ready",
        thumbnailArtifactId: "artifact-sequence",
        previewKind: "source",
        previewRevisionId: "rev-sequence",
        width: 640,
        height: 480,
        durationMs: 120,
      }],
      ["frame-1", { sequenceFrameArtifactId: "artifact-frame-1" }],
    ]));

    expect(next).toBe(assets);
    expect(next[0]).toBe(sequence);
    expect(next[0]!.sequence).toBe(sequence.sequence);
    expect(next[0]!.sequence!.frames[1]).toBe(frame);
  });

  it("patches only matching assets in one pass", () => {
    const assets = [asset("a"), asset("b")];
    const next = applyAssetThumbnailPatches(
      assets,
      new Map([
        [
          "b",
          {
            thumbnailStatus: "ready",
            thumbnailArtifactId: "art-b",
            width: 2560,
            height: 1440,
          },
        ],
      ]),
    );
    expect(next[0]).toBe(assets[0]);
    expect(next[1]).toMatchObject({
      assetId: "b",
      thumbnailStatus: "ready",
      thumbnailArtifactId: "art-b",
      width: 2560,
      height: 1440,
    });
  });

  it("changes only the matching sequence frame when its artifact ID changes", () => {
    const sequence = sequenceAsset();
    const other = asset("other");
    const assets = [sequence, other];
    const sequenceSummary = sequence.sequence!;
    const frames = sequenceSummary.frames;
    const next = applyAssetThumbnailPatches(
      assets,
      new Map([["frame-0", { sequenceFrameArtifactId: "artifact-frame-0-next" }]]),
    );

    expect(next).not.toBe(assets);
    expect(next[0]).not.toBe(sequence);
    expect(next[1]).toBe(other);
    expect(next[0]!.sequence).not.toBe(sequenceSummary);
    expect(next[0]!.sequence!.frames).not.toBe(frames);
    expect(next[0]!.sequence!.frames[0]).toMatchObject({
      assetId: "frame-0",
      thumbnailArtifactId: "artifact-frame-0-next",
    });
    expect(next[0]!.sequence!.frames[1]).toBe(frames[1]);
    expect(next[0]!.sequence!.frames[2]).toBe(frames[2]);
  });

  it("projects a newly discovered source-direct route and can clear a stale one", () => {
    const assets = [asset("small", {
      thumbnailArtifactId: "stale-thumbnail",
      width: null,
      height: null,
    })];
    const direct = applyAssetThumbnailPatches(
      assets,
      new Map([[
        "small",
        {
          width: 480,
          height: 480,
          previewKind: "source",
          previewRevisionId: "rev-small",
        },
      ]]),
    );
    expect(direct[0]).toMatchObject({
      width: 480,
      height: 480,
      previewKind: "source",
      previewRevisionId: "rev-small",
    });

    const cleared = applyAssetThumbnailPatches(
      direct,
      new Map([[
        "small",
        {
          thumbnailArtifactId: null,
          previewKind: null,
          previewRevisionId: null,
          thumbnailStatus: undefined,
        },
      ]]),
    );
    expect(cleared[0]).toMatchObject({
      thumbnailStatus: "pending",
      thumbnailArtifactId: null,
      previewKind: null,
      previewRevisionId: null,
    });
  });
});

describe("AssetDimensionPublicationTracker", () => {
  it("publishes an initial complete measurement even when summary dimensions already match", () => {
    const tracker = new AssetDimensionPublicationTracker();
    const summary = asset("a", { width: 640, height: 480 });
    const patches = new Map([["a", { width: 640, height: 480 }]]);
    const expected = [{ assetId: "a", width: 640, height: 480, mediaType: "image" }];

    expect(tracker.collect([summary], patches)).toEqual(expected);
  });

  it("skips duplicate publications but re-arms for a new revision, dimension or media type", () => {
    const tracker = new AssetDimensionPublicationTracker();
    const summary = asset("a", { width: 640, height: 480 });
    const sameDimensions = new Map([["a", { width: 640, height: 480 }]]);
    const changedDimensions = new Map([["a", { width: 800, height: 480 }]]);

    expect(tracker.collect([summary], sameDimensions)).toHaveLength(1);
    expect(tracker.collect([summary], sameDimensions)).toEqual([]);
    expect(tracker.collect([
      { ...summary, currentRevisionId: "rev-a-next" },
    ], sameDimensions)).toEqual([
      { assetId: "a", width: 640, height: 480, mediaType: "image" },
    ]);
    expect(tracker.collect([
      { ...summary, currentRevisionId: "rev-a-next" },
    ], changedDimensions)).toEqual([
      { assetId: "a", width: 800, height: 480, mediaType: "image" },
    ]);
    expect(tracker.collect([
      { ...summary, currentRevisionId: "rev-a-next", mediaType: "video" },
    ], changedDimensions)).toEqual([
      { assetId: "a", width: 800, height: 480, mediaType: "video" },
    ]);
  });

  it("ignores unknown summaries and incomplete or invalid dimensions", () => {
    const tracker = new AssetDimensionPublicationTracker();
    const assets = [
      asset("incomplete", { width: null, height: null }),
      asset("zero", { width: null, height: null }),
      asset("negative", { width: null, height: null }),
      asset("infinite", { width: null, height: null }),
      asset("nan", { width: null, height: null }),
    ];
    const patches = new Map([
      ["unknown", { width: 100, height: 100 }],
      ["incomplete", { width: 100 }],
      ["zero", { width: 0, height: 100 }],
      ["negative", { width: 100, height: -1 }],
      ["infinite", { width: Number.POSITIVE_INFINITY, height: 100 }],
      ["nan", { width: Number.NaN, height: 100 }],
    ]);

    expect(tracker.collect(assets, patches)).toEqual([]);
  });

  it("refreshes an existing asset’s LRU position and evicts the oldest entry", () => {
    const tracker = new AssetDimensionPublicationTracker(2);
    const assetA = asset("a", { width: 640, height: 480 });
    const assetB = asset("b", { width: 640, height: 480 });
    const assetC = asset("c", { width: 640, height: 480 });
    const patchFor = (assetId: string) => new Map([[assetId, { width: 640, height: 480 }]]);

    expect(tracker.collect([assetA], patchFor("a"))).toHaveLength(1);
    expect(tracker.collect([assetB], patchFor("b"))).toHaveLength(1);
    expect(tracker.collect([assetA], patchFor("a"))).toEqual([]);
    expect(tracker.collect([assetC], patchFor("c"))).toHaveLength(1);
    expect(tracker.collect([assetA], patchFor("a"))).toEqual([]);
    expect(tracker.collect([assetB], patchFor("b"))).toHaveLength(1);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects a non-positive-integer limit (%s)",
    (limit) => {
      expect(() => new AssetDimensionPublicationTracker(limit)).toThrow(RangeError);
    },
  );
});
