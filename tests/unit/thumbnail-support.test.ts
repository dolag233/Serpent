import { describe, expect, it } from "vitest";

import {
  assetSupportsThumbnail,
  isBenignThumbnailErrorCode,
} from "../../src/shared/thumbnail-support";
import { shouldShowThumbnailFailureBadge } from "../../src/renderer/thumbnail-failure-badge";

describe("assetSupportsThumbnail", () => {
  it("allows raster thumbs for image, video, and audio", () => {
    expect(
      assetSupportsThumbnail({ mediaType: "image", displayName: "a.jpg" }),
    ).toBe(true);
    expect(
      assetSupportsThumbnail({ mediaType: "video", displayName: "a.mp4" }),
    ).toBe(true);
    expect(
      assetSupportsThumbnail({ mediaType: "audio", displayName: "a.mp3" }),
    ).toBe(true);
  });

  it("rejects text and unknown formats", () => {
    expect(
      assetSupportsThumbnail({ mediaType: "text", displayName: "notes.md" }),
    ).toBe(false);
    expect(
      assetSupportsThumbnail({ mediaType: "other", displayName: "archive.zip" }),
    ).toBe(false);
    expect(
      assetSupportsThumbnail({ mediaType: "image", displayName: "layer.psd" }),
    ).toBe(true);
    expect(
      assetSupportsThumbnail({ mediaType: "image", displayName: "light.exr" }),
    ).toBe(true);
  });
});

describe("shouldShowThumbnailFailureBadge", () => {
  it("hides the badge for unsupported formats even when a failure is recorded", () => {
    expect(
      shouldShowThumbnailFailureBadge(
        {
          mediaType: "text",
          displayName: "readme.txt",
          thumbnailStatus: "failed",
        },
        true,
      ),
    ).toBe(false);
    expect(
      shouldShowThumbnailFailureBadge(
        {
          mediaType: "other",
          displayName: "bundle.zip",
          thumbnailStatus: "failed",
        },
        true,
      ),
    ).toBe(false);
  });

  it("shows the badge for decodable media with a recorded failure", () => {
    expect(
      shouldShowThumbnailFailureBadge(
        {
          mediaType: "image",
          displayName: "broken.jpg",
          thumbnailStatus: "failed",
        },
        true,
      ),
    ).toBe(true);
  });

  it("hides the badge once a ready thumbnail exists", () => {
    expect(
      shouldShowThumbnailFailureBadge(
        {
          mediaType: "image",
          displayName: "fixed.jpg",
          thumbnailStatus: "ready",
        },
        true,
      ),
    ).toBe(false);
  });
});

describe("isBenignThumbnailErrorCode", () => {
  it("treats unsupported format as benign", () => {
    expect(isBenignThumbnailErrorCode("UNSUPPORTED_FORMAT")).toBe(true);
    expect(isBenignThumbnailErrorCode("FFMPEG_REQUIRED")).toBe(false);
  });
});
