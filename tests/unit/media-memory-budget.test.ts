import { describe, expect, it } from "vitest";

import {
  estimateMediaNativeMemoryBytes,
  MEDIA_NATIVE_MEMORY_BUDGET_BYTES,
  MediaNativeMemoryBudget,
} from "../../src/worker/media-memory-budget";

const RESERVATION_UNIT = 8 * 1024 * 1024;

describe("media native memory budget", () => {
  it("estimates known raster inputs from pixels and bounded source staging", () => {
    const unknown = estimateMediaNativeMemoryBytes({ decoder: "sharp" });
    const small = estimateMediaNativeMemoryBytes({
      decoder: "sharp",
      sourceByteSize: 1_024,
      width: 512,
      height: 512,
    });
    const larger = estimateMediaNativeMemoryBytes({
      decoder: "sharp",
      sourceByteSize: 40 * 1024 * 1024,
      width: 4_096,
      height: 4_096,
    });
    const twoRasterCopies = estimateMediaNativeMemoryBytes({
      decoder: "sharp",
      sourceByteSize: 1_024,
      width: 4_096,
      height: 4_096,
      decodedRasterCopies: 2,
    });

    expect(small).toBeLessThan(unknown);
    expect(larger).toBeGreaterThan(small);
    expect(twoRasterCopies).toBeGreaterThan(larger);
    expect(larger).toBeLessThanOrEqual(MEDIA_NATIVE_MEMORY_BUDGET_BYTES);
    expect(estimateMediaNativeMemoryBytes({ decoder: "oiio" })).toBeGreaterThan(unknown);
  });

  it("never overlaps reservations beyond capacity and releases after completion", async () => {
    const budget = new MediaNativeMemoryBudget(RESERVATION_UNIT * 3);
    let releaseFirst!: () => void;
    const first = budget.run(undefined, RESERVATION_UNIT * 2, () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    await Promise.resolve();

    let secondStarted = false;
    const second = budget.run(undefined, RESERVATION_UNIT * 2, async () => {
      secondStarted = true;
    });
    await Promise.resolve();
    expect(secondStarted).toBe(false);
    expect(budget.usedBytes).toBe(RESERVATION_UNIT * 2);

    releaseFirst();
    await first;
    await second;
    expect(secondStarted).toBe(true);
    expect(budget.usedBytes).toBe(0);
    expect(budget.peakUsedBytes).toBe(RESERVATION_UNIT * 2);
  });

  it("cancels a waiter without consuming or leaking a reservation", async () => {
    const budget = new MediaNativeMemoryBudget(RESERVATION_UNIT * 2);
    let releaseFirst!: () => void;
    const first = budget.run(undefined, RESERVATION_UNIT * 2, () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    await Promise.resolve();

    const controller = new AbortController();
    const waiting = budget.run(controller.signal, RESERVATION_UNIT, async () => undefined);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(budget.usedBytes).toBe(RESERVATION_UNIT * 2);

    releaseFirst();
    await first;
    expect(budget.usedBytes).toBe(0);
  });

  it("admits the next fitting waiter after an oversized waiter is aborted", async () => {
    const budget = new MediaNativeMemoryBudget(RESERVATION_UNIT * 2);
    let releaseFirst!: () => void;
    const first = budget.run(undefined, RESERVATION_UNIT, () => new Promise<void>((resolve) => {
      releaseFirst = resolve;
    }));
    await Promise.resolve();

    const controller = new AbortController();
    const oversized = budget.run(controller.signal, RESERVATION_UNIT * 2, async () => "oversized");
    const second = budget.run(undefined, RESERVATION_UNIT, async () => "second");
    controller.abort();

    await expect(oversized).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).resolves.toBe("second");
    releaseFirst();
    await first;
    expect(budget.usedBytes).toBe(0);
  });
});
