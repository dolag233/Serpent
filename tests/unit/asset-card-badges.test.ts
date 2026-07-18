import { describe, expect, it } from "vitest";
import {
  assetTypeBadgeLabel,
  fileExtensionLabel,
  shouldShowDurationBadge,
} from "../../src/renderer/asset-card-badges";

describe("asset-card-badges", () => {
  it("labels gif, video, and audio for type chips", () => {
    expect(assetTypeBadgeLabel("image", "loop.gif")).toBe("GIF");
    expect(assetTypeBadgeLabel("video", "clip.mp4")).toBe("VIDEO");
    expect(assetTypeBadgeLabel("audio", "tone.wav")).toBe("AUDIO");
    expect(assetTypeBadgeLabel("image", "still.jpg")).toBeNull();
    expect(assetTypeBadgeLabel("other", "notes.txt")).toBeNull();
  });

  it("shows duration for video, audio, and gif when present", () => {
    expect(shouldShowDurationBadge("video", "a.mp4", 2500)).toBe(true);
    expect(shouldShowDurationBadge("audio", "a.wav", 2500)).toBe(true);
    expect(shouldShowDurationBadge("image", "a.gif", 1200)).toBe(true);
    expect(shouldShowDurationBadge("image", "a.jpg", 1200)).toBe(false);
    expect(shouldShowDurationBadge("video", "a.mp4", null)).toBe(false);
    expect(shouldShowDurationBadge("video", "a.mp4", 0)).toBe(false);
  });

  it("truncates long extensions", () => {
    expect(fileExtensionLabel("x.jpeg")).toBe("JPEG");
    expect(fileExtensionLabel("x.toolongext")).toBe("TOOLO");
    expect(fileExtensionLabel("noext")).toBe("FILE");
  });
});
