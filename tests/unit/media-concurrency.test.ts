import { describe, expect, it } from "vitest";

import {
  mediaDecodeConcurrency,
  mediaDecodeWaveSize,
} from "../../src/shared/media-concurrency";
import { physicalCpuCountFromProcCpuInfo } from "../../src/worker/media-concurrency";

describe("mediaDecodeConcurrency", () => {
  it("reserves two physical cores and one Serpent core", () => {
    expect(mediaDecodeConcurrency(16)).toBe(13);
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

describe("physical CPU topology parsing", () => {
  it("counts unique physical/socket core pairs from Linux cpuinfo blocks", () => {
    expect(physicalCpuCountFromProcCpuInfo([
      "processor : 0",
      "physical id : 0",
      "core id : 0",
      "",
      "processor : 1",
      "physical id : 0",
      "core id : 0",
      "",
      "processor : 2",
      "physical id : 0",
      "core id : 1",
      "",
      "processor : 3",
      "physical id : 1",
      "core id : 0",
    ].join("\n"))).toBe(3);
  });

  it("returns undefined when Linux topology fields are unavailable", () => {
    expect(physicalCpuCountFromProcCpuInfo("processor : 0\nmodel name : test")).toBeUndefined();
  });
});
