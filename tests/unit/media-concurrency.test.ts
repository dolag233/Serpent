import { describe, expect, it } from "vitest";

import {
  mediaDecodeConcurrency,
  mediaDecodeWaveSize,
} from "../../src/shared/media-concurrency";
import { physicalCpuCountFromProcCpuInfo } from "../../src/worker/media-concurrency";
import {
  MediaResourceGuard,
  isMediaResourceExhaustion,
  MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE,
} from "../../src/worker/media-resource-guard";

describe("mediaDecodeConcurrency", () => {
  it("keeps the queue bounded for memory-heavy native decoders", () => {
    expect(mediaDecodeConcurrency(16)).toBe(2);
    expect(mediaDecodeConcurrency(8)).toBe(2);
    expect(mediaDecodeConcurrency(4)).toBe(2);
  });

  it("never drops below one worker", () => {
    expect(mediaDecodeConcurrency(3)).toBe(2);
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

describe("media resource pressure", () => {
  it("recognizes native allocation failures from spawn and FFmpeg", () => {
    expect(isMediaResourceExhaustion({ code: "ENOMEM" })).toBe(true);
    expect(isMediaResourceExhaustion({
      exitCode: 3221225725,
      stderr: "get_buffer() failed: Cannot allocate memory",
    })).toBe(true);
    expect(isMediaResourceExhaustion({ exitCode: 3221225495, stderr: "" })).toBe(true);
    expect(isMediaResourceExhaustion({ exitCode: 1, stderr: "Invalid data found when processing input" }))
      .toBe(false);
    expect(isMediaResourceExhaustion({ code: "UNKNOWN", message: "spawn UNKNOWN" })).toBe(false);
    expect(isMediaResourceExhaustion({ stderr: "STATUS_ACCESS_VIOLATION" })).toBe(false);
    expect(MEDIA_RESOURCE_EXHAUSTED_ERROR_CODE).toBe("MEDIA_RESOURCE_EXHAUSTED");
  });

  it("backs off exponentially and resets after healthy time", () => {
    let now = 0;
    const guard = new MediaResourceGuard(100, 500, () => now);
    expect(guard.recordFailure()).toBe(100);
    expect(guard.isCoolingDown()).toBe(true);
    now = 100;
    expect(guard.isCoolingDown()).toBe(false);
    guard.recordHealthyCompletion();
    expect(guard.recordFailure()).toBe(100);
    expect(guard.recordFailure()).toBe(200);
  });

  it("holds new media claims while a synchronous import owns the worker", () => {
    const guard = new MediaResourceGuard(30_000, 300_000, () => 1_000);

    expect(guard.isCoolingDown()).toBe(false);
    guard.enterExternalHold();
    guard.enterExternalHold();
    expect(guard.isCoolingDown()).toBe(true);

    guard.exitExternalHold();
    expect(guard.isCoolingDown()).toBe(true);
    guard.exitExternalHold();
    expect(guard.isCoolingDown()).toBe(false);
  });
});
