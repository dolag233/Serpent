import { describe, expect, it } from "vitest";
import {
  ASSET_CARD_BADGE_MIN_SIZE,
  assetTypeBadgeLabel,
  fileExtensionLabel,
  formatSequenceDuration,
  shouldShowAssetCardBadges,
  shouldShowDurationBadge,
  shouldShowExtensionBadge,
  shouldShowTypeBadgeAlongsideExtension,
} from "../../src/renderer/asset-card-badges";

describe("asset-card-badges", () => {
  it("labels gif, video, and text for type chips; audio uses extension instead", () => {
    expect(assetTypeBadgeLabel("image", "loop.gif")).toBe("GIF");
    expect(assetTypeBadgeLabel("video", "clip.mp4")).toBe("VIDEO");
    expect(assetTypeBadgeLabel("audio", "tone.wav")).toBeNull();
    expect(assetTypeBadgeLabel("text", "notes.txt")).toBe("TEXT");
    expect(assetTypeBadgeLabel("image", "still.jpg")).toBeNull();
    expect(assetTypeBadgeLabel("other", "notes.bin")).toBeNull();
  });

  it("shows extension badges for non-images only (Serpent-i07)", () => {
    expect(shouldShowExtensionBadge("image")).toBe(false);
    expect(shouldShowExtensionBadge("audio")).toBe(true);
    expect(shouldShowExtensionBadge("video")).toBe(true);
    expect(shouldShowExtensionBadge("text")).toBe(true);
    expect(shouldShowExtensionBadge("other")).toBe(true);
  });

  it("hides the type chip when extension occupies bottom-right", () => {
    expect(shouldShowTypeBadgeAlongsideExtension(true)).toBe(false);
    expect(shouldShowTypeBadgeAlongsideExtension(false)).toBe(true);
  });

  it("shows duration for video, audio, and gif when present", () => {
    expect(shouldShowDurationBadge("video", "a.mp4", 2500)).toBe(true);
    expect(shouldShowDurationBadge("audio", "a.wav", 2500)).toBe(true);
    expect(shouldShowDurationBadge("image", "a.gif", 1200)).toBe(true);
    expect(shouldShowDurationBadge("image", "a.jpg", 1200)).toBe(false);
    expect(shouldShowDurationBadge("video", "a.mp4", null)).toBe(false);
    expect(shouldShowDurationBadge("video", "a.mp4", 0)).toBe(false);
  });

  it("formats sequence duration from frame count and FPS", () => {
    expect(formatSequenceDuration(3, 13)).toBe("0.23s");
    expect(formatSequenceDuration(151, 30)).toBe("5.03s");
    expect(formatSequenceDuration(1_800, 30)).toBe("1:00");
  });

  it("hides corner badges when the card preview is too small (Serpent-7zt)", () => {
    expect(shouldShowAssetCardBadges(ASSET_CARD_BADGE_MIN_SIZE)).toBe(true);
    expect(shouldShowAssetCardBadges(ASSET_CARD_BADGE_MIN_SIZE - 1)).toBe(false);
    expect(shouldShowAssetCardBadges(96)).toBe(false);
    expect(shouldShowAssetCardBadges(320)).toBe(true);
  });

  it("truncates long extensions", () => {
    expect(fileExtensionLabel("x.jpeg")).toBe("JPEG");
    expect(fileExtensionLabel("x.toolongext")).toBe("TOOLO");
    expect(fileExtensionLabel("noext")).toBe("FILE");
  });
});
