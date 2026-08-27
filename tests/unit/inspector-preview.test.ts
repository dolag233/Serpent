import { describe, expect, it } from "vitest";

import { resolveInspectorPreviewSrc } from "../../src/renderer/inspector-preview";

describe("resolveInspectorPreviewSrc", () => {
  it("returns a scoped custom-protocol URL only for a ready artifact", () => {
    expect(resolveInspectorPreviewSrc(
      { thumbnailStatus: "ready", thumbnailArtifactId: "artifact-1" },
      { libraryId: "library-1" },
    )).toBe("serpent://preview/library-1/artifact-1");
    expect(resolveInspectorPreviewSrc(
      { thumbnailStatus: "pending", thumbnailArtifactId: null },
      { libraryId: "library-1" },
    )).toBeNull();
    expect(resolveInspectorPreviewSrc(
      { thumbnailStatus: "ready", thumbnailArtifactId: "artifact-1" },
      null,
    )).toBeNull();
  });

  it("uses the bounded source-direct fallback for eligible images", () => {
    expect(resolveInspectorPreviewSrc(
      {
        assetId: "asset-1",
        availability: "available",
        deletedAt: null,
        mediaType: "image",
        previewKind: "source",
        previewRevisionId: "revision-1",
        thumbnailArtifactId: null,
        thumbnailStatus: "pending",
      },
      { libraryId: "library-1" },
    )).toBe(
      "serpent://source/library-1/asset-1?revision=revision-1",
    );
    expect(resolveInspectorPreviewSrc(
      {
        assetId: "asset-1",
        mediaType: "image",
        previewKind: "source",
        previewRevisionId: "revision-1",
        thumbnailArtifactId: null,
        thumbnailStatus: "pending",
      },
      { libraryId: "library-1" },
    )).toBe("serpent://source/library-1/asset-1?revision=revision-1");
    expect(resolveInspectorPreviewSrc(
      {
        assetId: "asset-1",
        availability: "missing",
        mediaType: "image",
        previewKind: "source",
        previewRevisionId: "revision-1",
        thumbnailArtifactId: null,
        thumbnailStatus: "pending",
      },
      { libraryId: "library-1" },
    )).toBeNull();
  });
});
