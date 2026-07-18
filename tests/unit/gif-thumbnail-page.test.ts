import { describe, expect, it } from "vitest";
import {
  pickBestGifPage,
  sampleGifPageIndices,
  scoreRawRgbFrame,
} from "../../src/worker/gif-thumbnail-page";

describe("gif-thumbnail-page", () => {
  it("samples uniformly including endpoints", () => {
    expect(sampleGifPageIndices(1)).toEqual([0]);
    expect(sampleGifPageIndices(5, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleGifPageIndices(10, 3)).toEqual([0, 5, 9]);
    expect(sampleGifPageIndices(208, 24)[0]).toBe(0);
    expect(sampleGifPageIndices(208, 24).at(-1)).toBe(207);
    expect(sampleGifPageIndices(208, 24)).toHaveLength(24);
  });

  it("scores black frames near zero and bright frames high", () => {
    const black = new Uint8Array(12); // 4 black RGB pixels
    expect(scoreRawRgbFrame(black, 3)).toBe(0);

    const bright = new Uint8Array([200, 180, 160, 210, 190, 170, 220, 200, 180]);
    expect(scoreRawRgbFrame(bright, 3)).toBeGreaterThan(100);
  });

  it("picks the highest-scoring page and falls back when all black", () => {
    expect(
      pickBestGifPage(
        [
          { page: 0, score: 0.1 },
          { page: 12, score: 40 },
          { page: 20, score: 35 },
        ],
        40,
      ),
    ).toBe(12);
    expect(pickBestGifPage([{ page: 0, score: 0 }], 86)).toBe(
      Math.floor((86 - 1) * 0.25),
    );
    expect(pickBestGifPage([], 86)).toBe(Math.floor((86 - 1) * 0.25));
  });
});
