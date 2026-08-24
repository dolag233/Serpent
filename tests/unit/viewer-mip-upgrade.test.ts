import { describe, expect, it } from "vitest";

import {
  canPresentViewerPlaceholder,
  isDecodedImage,
  resolveViewerImageDisplay,
  resolveViewerPlaceholderUrl,
} from "../../src/renderer/viewer-mip-upgrade";

const readyImage = {
  displayName: "image.png",
  mediaType: "image" as const,
  thumbnailStatus: "ready" as const,
  thumbnailArtifactId: "art-1",
};
const readyDocument = {
  displayName: "document.pdf",
  mediaType: "document" as const,
  thumbnailStatus: "ready" as const,
  thumbnailArtifactId: "pdf-art-1",
};

describe("viewer mip upgrade (Serpent-eh07)", () => {
  it("builds preview URLs for ready image and document thumbnails", () => {
    expect(resolveViewerPlaceholderUrl(readyImage, "lib-1")).toBe(
      "serpent://preview/lib-1/art-1",
    );
    expect(
      resolveViewerPlaceholderUrl(
        { ...readyImage, mediaType: "video" },
        "lib-1",
      ),
    ).toBeNull();
    expect(
      resolveViewerPlaceholderUrl(
        { ...readyImage, thumbnailStatus: "pending", thumbnailArtifactId: null },
        "lib-1",
      ),
    ).toBeNull();
    expect(canPresentViewerPlaceholder(readyImage, "lib-1")).toBe(true);
    expect(resolveViewerPlaceholderUrl(readyDocument, "lib-1")).toBe(
      "serpent://preview/lib-1/pdf-art-1",
    );
    expect(
      resolveViewerPlaceholderUrl(
        { ...readyDocument, displayName: "page.html" },
        "lib-1",
      ),
    ).toBeNull();
  });

  it("keeps placeholder visible until full image has decoded", () => {
    const placeholder = "serpent://preview/lib/art";
    const full = "serpent://source/lib/asset?revision=r1";

    expect(
      resolveViewerImageDisplay({
        placeholderUrl: placeholder,
        fullUrl: null,
        fullDecoded: false,
      }),
    ).toEqual({
      displayUrl: placeholder,
      upgrading: false,
      layer: "placeholder",
    });

    expect(
      resolveViewerImageDisplay({
        placeholderUrl: placeholder,
        fullUrl: full,
        fullDecoded: false,
      }),
    ).toEqual({
      displayUrl: placeholder,
      upgrading: true,
      layer: "placeholder",
    });

    expect(
      resolveViewerImageDisplay({
        placeholderUrl: placeholder,
        fullUrl: full,
        fullDecoded: true,
      }),
    ).toEqual({
      displayUrl: full,
      upgrading: false,
      layer: "full",
    });
  });

  it("proves decode via complete && naturalWidth > 0", () => {
    expect(isDecodedImage({ complete: true, naturalWidth: 800 })).toBe(true);
    expect(isDecodedImage({ complete: true, naturalWidth: 0 })).toBe(false);
    expect(isDecodedImage({ complete: false, naturalWidth: 800 })).toBe(false);
  });
});
