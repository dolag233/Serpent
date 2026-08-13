import { describe, expect, it } from "vitest";

import {
  mediaDecodeConcurrency,
  mediaDecodeWaveSize,
} from "../../src/shared/media-concurrency";

describe("mediaDecodeConcurrency", () => {
  it("reserves two OS threads and one Serpent thread", () => {
    expect(mediaDecodeConcurrency(24)).toBe(21);
    expect(mediaDecodeConcurrency(8)).toBe(5);
    expect(mediaDecodeConcurrency(4)).toBe(1);
  });

  it("never drops below one worker", () => {
    expect(mediaDecodeConcurrency(3)).toBe(1);
    expect(mediaDecodeConcurrency(1)).toBe(1);
    expect(mediaDecodeConcurrency(0)).toBe(1);
    expect(mediaDecodeConcurrency(Number.NaN)).toBe(1);
  });
});

describe("mediaDecodeWaveSize", () => {
  it("keeps the claim wave at twice the live pool", () => {
    expect(mediaDecodeWaveSize(21)).toBe(42);
    expect(mediaDecodeWaveSize(1)).toBe(2);
  });
});
