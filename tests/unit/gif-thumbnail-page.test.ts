import { describe, expect, it } from "vitest";
import {
  GIF_GOOD_PAGE_SCORE_THRESHOLD,
  GIF_THUMBNAIL_MAX_PAGE_SAMPLES,
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

  it("caps the default probe spread at the fast-preview budget (Serpent-azf6)", () => {
    expect(GIF_THUMBNAIL_MAX_PAGE_SAMPLES).toBe(12);
    expect(sampleGifPageIndices(200)).toHaveLength(12);
    expect(sampleGifPageIndices(200)[0]).toBe(0);
    expect(sampleGifPageIndices(200).at(-1)).toBe(199);
    // Fewer pages than the budget sample every page.
    expect(sampleGifPageIndices(6)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("scores black frames near zero and bright frames high", () => {
    const black = new Uint8Array(12); // 4 black RGB pixels
    expect(scoreRawRgbFrame(black, 3)).toBe(0);

    const bright = new Uint8Array([200, 180, 160, 210, 190, 170, 220, 200, 180]);
    expect(scoreRawRgbFrame(bright, 3)).toBeGreaterThan(100);
  });

  it("keeps the early-exit threshold conservative enough for dark GIFs (Serpent-azf6)", () => {
    expect(GIF_GOOD_PAGE_SCORE_THRESHOLD).toBe(50);
    // A dim-but-visible frame stays below the threshold so the probe keeps
    // looking; a recognizable bright frame passes and stops the probe.
    const dim = new Uint8Array(64 * 64 * 3).fill(20);
    expect(scoreRawRgbFrame(dim, 3)).toBeLessThan(GIF_GOOD_PAGE_SCORE_THRESHOLD);
    const mid = new Uint8Array(64 * 64 * 3).fill(90);
    expect(scoreRawRgbFrame(mid, 3)).toBeGreaterThan(GIF_GOOD_PAGE_SCORE_THRESHOLD);
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
    // Early exit leaves only the pages probed before the first good frame;
    // the best of those is still selected over pure-black candidates.
    expect(
      pickBestGifPage(
        [
          { page: 0, score: 0 },
          { page: 4, score: 160 },
          { page: 8, score: 120 },
        ],
        20,
      ),
    ).toBe(4);
    expect(pickBestGifPage([{ page: 0, score: 0 }], 86)).toBe(
      Math.floor((86 - 1) * 0.25),
    );
    expect(pickBestGifPage([], 86)).toBe(Math.floor((86 - 1) * 0.25));
  });
});
