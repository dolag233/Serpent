import { describe, expect, it } from "vitest";

import { resolveSequenceFrameUrl } from "../../src/renderer/sequence-frame-preview";

describe("resolveSequenceFrameUrl", () => {
  it("prefers a ready artifact over source-direct metadata", () => {
    expect(resolveSequenceFrameUrl("library-1", {
      assetId: "asset-1",
      thumbnailArtifactId: "artifact-1",
      previewKind: "source",
      previewRevisionId: "revision-1",
    })).toBe("serpent://preview/library-1/artifact-1");
  });

  it("uses the frame's own revision-pinned source URL", () => {
    expect(resolveSequenceFrameUrl("library-1", {
      assetId: "asset-2",
      thumbnailArtifactId: null,
      previewKind: "source",
      previewRevisionId: "revision-2",
    })).toBe("serpent://source/library-1/asset-2?revision=revision-2");
  });

  it("does not borrow another frame's URL when no preview is admitted", () => {
    expect(resolveSequenceFrameUrl("library-1", {
      assetId: "asset-3",
      thumbnailArtifactId: null,
      previewKind: null,
      previewRevisionId: null,
    })).toBeNull();
  });
});
