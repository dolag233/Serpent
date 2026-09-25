import { describe, expect, it } from "vitest";

import {
  gifAdjacentFrameIndex,
  gifDelayFromCentiseconds,
  gifFrameIndexAtTime,
  gifPlaybackFrames,
  gifTimeAtFrameStart,
  gifTimelineDurationMs,
  gifWrapPlaybackTimeMs,
  readGifFrameTimings,
} from "../../src/renderer/gif-playback-timeline";

function gifBytes(delaysCs: number[]): Uint8Array {
  const chunks: number[] = [
    ..."GIF89a".split("").map((char) => char.charCodeAt(0)),
    0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  ];
  for (const delay of delaysCs) {
    chunks.push(
      0x21, 0xf9, 0x04, 0x00,
      delay & 0xff, (delay >> 8) & 0xff,
      0x00, 0x00,
      0x2c,
      0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0x02, 0x02, 0x44, 0x01, 0x00,
    );
  }
  chunks.push(0x3b);
  return Uint8Array.from(chunks);
}

describe("gif playback timeline", () => {
  const frames = [{ durationMs: 100 }, { durationMs: 50 }, { durationMs: 200 }];

  it("treats delays under 2 centiseconds as 100ms", () => {
    expect(gifDelayFromCentiseconds(0)).toBe(100);
    expect(gifDelayFromCentiseconds(1)).toBe(100);
    expect(gifDelayFromCentiseconds(2)).toBe(20);
    expect(gifDelayFromCentiseconds(10)).toBe(100);
  });

  it("maps time onto frame starts and clamps at the ends", () => {
    expect(gifTimelineDurationMs(frames)).toBe(350);
    expect(gifFrameIndexAtTime(frames, 0)).toBe(0);
    expect(gifFrameIndexAtTime(frames, 100)).toBe(1);
    expect(gifFrameIndexAtTime(frames, 149)).toBe(1);
    expect(gifFrameIndexAtTime(frames, 150)).toBe(2);
    expect(gifFrameIndexAtTime(frames, 999)).toBe(2);
    expect(gifTimeAtFrameStart(frames, 2)).toBe(150);
    expect(gifAdjacentFrameIndex(3, 0, -1)).toBe(0);
    expect(gifAdjacentFrameIndex(3, 0, 1)).toBe(1);
    expect(gifAdjacentFrameIndex(3, 2, 1)).toBe(2);
    expect(gifWrapPlaybackTimeMs(360, 350)).toBe(10);
  });

  it("reads graphic-control delays from a GIF buffer", () => {
    const parsed = readGifFrameTimings(gifBytes([0, 5, 10]));
    expect(parsed?.delaysMs).toEqual([100, 50, 100]);
    expect(gifPlaybackFrames(parsed, 3).map((frame) => frame.durationMs)).toEqual([
      100, 50, 100,
    ]);
    expect(readGifFrameTimings(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
