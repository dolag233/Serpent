import { describe, expect, it } from "vitest";

import { folderCoverImageSrc } from "../../src/renderer/folder-cover";

describe("folderCoverImageSrc", () => {
  it("prefers a thumbnail artifact", () => {
    expect(folderCoverImageSrc("lib", {
      coverArtifactIds: ["art-1"],
      coverSourcePreviews: [{ assetId: "asset", revisionId: "rev" }],
    })).toBe("serpent://preview/lib/art-1");
  });

  it("uses the sequence frame file when the folder has no thumbnail", () => {
    expect(folderCoverImageSrc("lib", {
      coverArtifactIds: [],
      coverSourcePreviews: [{ assetId: "frame", revisionId: "rev 1" }],
    })).toBe("serpent://source/lib/frame?revision=rev%201");
  });

  it("returns nothing when the folder has no paintable cover", () => {
    expect(folderCoverImageSrc("lib", { coverArtifactIds: [] })).toBeNull();
  });
});
