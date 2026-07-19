import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  assetSummarySchema,
  extractedVideoMetadataSchema,
} from "../../src/shared/asset-types";
import { formatAudioTechnicalLine } from "../../src/renderer/video-metadata-format";

describe("audio extracted metadata fixture", () => {
  it("parses and formats the library mp3 probe json", () => {
    const raw = JSON.parse(
      readFileSync(
        "/Users/dolag/Documents/Temp/我的资源库/.serpent/artifacts/6eb3af23-e3f2-4a46-bd56-8e7794e8fd0e.json",
        "utf8",
      ),
    );
    const parsed = extractedVideoMetadataSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(formatAudioTechnicalLine(parsed.data)).toBe(
      "mp3 · 256 kbps · 44.1 kHz · stereo",
    );
  });

  it("accepts audio AssetSummary with null dimensions and durationMs", () => {
    const parsed = assetSummarySchema.safeParse({
      assetId: "a",
      locationKind: "managed",
      managedFolderId: null,
      relativeFilePath: "x.mp3",
      displayName: "x.mp3",
      currentRevisionId: "r",
      byteSize: 1,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      availability: "available",
      rating: 0,
      favorite: false,
      deletedAt: null,
      trashedFromPath: null,
      remainingDays: null,
      thumbnailStatus: "ready",
      thumbnailArtifactId: "t",
      mediaType: "audio",
      width: 0,
      height: 0,
      durationMs: 124839,
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts null width/height for audio", () => {
    const parsed = assetSummarySchema.safeParse({
      assetId: "a",
      locationKind: "managed",
      managedFolderId: null,
      relativeFilePath: "x.mp3",
      displayName: "x.mp3",
      currentRevisionId: "r",
      byteSize: 1,
      modifiedAt: "2026-01-01T00:00:00.000Z",
      availability: "available",
      rating: 0,
      favorite: false,
      deletedAt: null,
      trashedFromPath: null,
      remainingDays: null,
      thumbnailStatus: "ready",
      thumbnailArtifactId: "t",
      mediaType: "audio",
      width: null,
      height: null,
      durationMs: 124839,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.durationMs).toBe(124839);
  });
});
