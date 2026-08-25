import { describe, expect, it } from "vitest";

import {
  formatAudioTechnicalLine,
  formatBitrate,
  formatFrameRate,
  formatSampleRate,
  formatVideoTechnicalLine,
  parseFrameRateFps,
  parseProbeNumber,
} from "../../src/renderer/video-metadata-format";
import {
  extractedMetadataResultSchema,
  extractedVideoMetadataSchema,
} from "../../src/shared/asset-types";
import { parseRendererRequest, parseWorkerRequest } from "../../src/shared/protocol/requests";
import { parseRendererResult, parseWorkerResponse } from "../../src/shared/protocol/responses";

const EMPTY_RAW_IMAGE_METADATA = {
  captureDate: null,
  author: null,
  cameraMake: null,
  cameraModel: null,
  lensModel: null,
  iso: null,
  fNumber: null,
  exposureTime: null,
  exposureCompensation: null,
  exposureProgram: null,
  meteringMode: null,
  flash: null,
  focalLength: null,
};

describe("video-metadata-format", () => {
  it("parses ffprobe ratio and plain fps", () => {
    expect(parseFrameRateFps("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRateFps("30/1")).toBe(30);
    expect(parseFrameRateFps("24")).toBe(24);
    expect(parseFrameRateFps(null, 59.94)).toBeCloseTo(59.94, 2);
    expect(parseFrameRateFps("0/1")).toBeNull();
    expect(parseFrameRateFps("bad")).toBeNull();
  });

  it("parses probe numeric strings", () => {
    expect(parseProbeNumber("5000000")).toBe(5_000_000);
    expect(parseProbeNumber(48000)).toBe(48_000);
    expect(parseProbeNumber("0")).toBeNull();
    expect(parseProbeNumber(null)).toBeNull();
  });

  it("formats fps / bitrate / sample rate for compact display", () => {
    expect(formatFrameRate(29.97002997)).toBe("29.97 fps");
    expect(formatFrameRate(30)).toBe("30 fps");
    expect(formatBitrate(5_000_000)).toBe("5 Mbps");
    expect(formatBitrate(5_500_000)).toBe("5.5 Mbps");
    expect(formatBitrate(256_000)).toBe("256 kbps");
    expect(formatSampleRate(48_000)).toBe("48 kHz");
    expect(formatSampleRate(44_100)).toBe("44.1 kHz");
  });

  it("builds the compact technical line", () => {
    const line = formatVideoTechnicalLine({
      ...EMPTY_RAW_IMAGE_METADATA,
      container: "mov,mp4,m4a,3gp,3g2,mj2",
      durationMs: 30_050,
      width: 1920,
      height: 1080,
      framerate: "30000/1001",
      videoCodec: "h264",
      videoBitrate: "5000000",
      pixelFormat: "yuv420p",
      hasAudio: true,
      audioCodec: "aac",
      audioBitrate: null,
      sampleRate: "48000",
      channels: 2,
      containerBitrate: "5500000",
    });
    expect(line).toBe("29.97 fps · 5 Mbps · h264 · aac 48 kHz");
  });

  it("falls back to container bitrate and omits silent audio", () => {
    expect(formatVideoTechnicalLine({
      ...EMPTY_RAW_IMAGE_METADATA,
      container: null,
      framerate: "24/1",
      videoCodec: "vp9",
      videoBitrate: null,
      hasAudio: false,
      audioCodec: null,
      audioBitrate: null,
      sampleRate: null,
      channels: null,
      pixelFormat: null,
      containerBitrate: "2000000",
    })).toBe("24 fps · 2 Mbps · vp9");
  });

  it("returns null when no technical fields are present", () => {
    expect(formatVideoTechnicalLine({
      ...EMPTY_RAW_IMAGE_METADATA,
      container: null,
      framerate: null,
      videoCodec: null,
      videoBitrate: null,
      hasAudio: false,
      audioCodec: null,
      audioBitrate: null,
      sampleRate: null,
      channels: null,
      pixelFormat: null,
    })).toBeNull();
  });

  it("builds the compact audio technical line (Serpent-i07)", () => {
    expect(formatAudioTechnicalLine({
      ...EMPTY_RAW_IMAGE_METADATA,
      container: "mp3",
      hasAudio: true,
      audioCodec: "mp3",
      audioBitrate: "320000",
      sampleRate: "44100",
      channels: 2,
      videoCodec: null,
      videoBitrate: null,
      framerate: null,
      pixelFormat: null,
      containerBitrate: "320000",
    })).toBe("mp3 · 320 kbps · 44.1 kHz · stereo");
  });

  it("falls back to container bitrate for audio when stream bitrate is missing", () => {
    expect(formatAudioTechnicalLine({
      ...EMPTY_RAW_IMAGE_METADATA,
      container: "mp3",
      hasAudio: true,
      audioCodec: "mp3",
      audioBitrate: null,
      sampleRate: "48000",
      channels: 1,
      videoCodec: null,
      videoBitrate: null,
      framerate: null,
      pixelFormat: null,
      containerBitrate: "192000",
    })).toBe("mp3 · 192 kbps · 48 kHz · mono");
  });
});

describe("extracted metadata schema + protocol", () => {
  it("accepts the ffprobe JSON shape already written by the worker", () => {
    const parsed = extractedVideoMetadataSchema.parse({
      container: "mov,mp4,m4a,3gp,3g2,mj2",
      durationMs: 30050,
      width: 1920,
      height: 1080,
      framerate: "30000/1001",
      rotation: -90,
      videoCodec: "h264",
      videoBitrate: "5000000",
      pixelFormat: "yuv420p",
      hasAudio: true,
      audioCodec: "aac",
      sampleRate: "48000",
      channels: 2,
      containerBitrate: "5500000",
    });
    expect(parsed.videoCodec).toBe("h264");
    expect(parsed.containerBitrate).toBe("5500000");
  });

  it("wires asset.extracted-metadata.get through request/response schemas", () => {
    expect(parseRendererRequest({
      type: "asset.extracted-metadata.get.request",
      libraryId: "lib-1",
      assetId: "asset-1",
    })).toMatchObject({ assetId: "asset-1" });

    expect(parseWorkerRequest({
      requestId: "req-1",
      command: {
        type: "asset.extracted-metadata.get",
        libraryId: "lib-1",
        assetId: "asset-1",
      },
    }).command.type).toBe("asset.extracted-metadata.get");

    const result = {
      ok: true as const,
      type: "asset.extracted-metadata.got" as const,
      result: extractedMetadataResultSchema.parse({
        assetId: "asset-1",
        status: "ready",
        metadata: {
          framerate: "30/1",
          videoCodec: "h264",
          videoBitrate: "1000000",
          hasAudio: true,
          audioCodec: "aac",
          sampleRate: "48000",
          channels: 2,
        },
        errorCode: null,
      }),
    };
    expect(parseRendererResult(result)).toMatchObject({
      type: "asset.extracted-metadata.got",
    });
    expect(parseWorkerResponse({
      requestId: "req-1",
      result,
    }).result).toMatchObject({ type: "asset.extracted-metadata.got" });
  });

  it("accepts pending / missing / failed without metadata", () => {
    for (const status of ["pending", "missing", "failed"] as const) {
      expect(extractedMetadataResultSchema.parse({
        assetId: "asset-1",
        status,
        metadata: null,
        errorCode: status === "failed" ? "MEDIA_PROCESSING_FAILED" : null,
      }).status).toBe(status);
    }
  });
});
