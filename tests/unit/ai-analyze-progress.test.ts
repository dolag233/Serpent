import { describe, expect, it } from "vitest";

import {
  collectRecentAiFailureCodes,
  computeAiBatchProgress,
  inferAutoAnalyzeBatchTotal,
} from "../../src/renderer/ai-analyze-progress";

describe("computeAiBatchProgress (Serpent-k3dw)", () => {
  it("computes determinate ratio from batch baseline deltas", () => {
    const snapshot = computeAiBatchProgress(
      4,
      { succeeded: 10, failed: 2 },
      { queued: 1, running: 1, succeeded: 12, failed: 3 },
    );
    expect(snapshot.done).toBe(3);
    expect(snapshot.succeeded).toBe(2);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.ratio).toBeCloseTo(0.75);
  });

  it("returns null ratio when batch total is unknown", () => {
    const snapshot = computeAiBatchProgress(
      0,
      { succeeded: 0, failed: 0 },
      { queued: 2, running: 1, succeeded: 0, failed: 0 },
    );
    expect(snapshot.ratio).toBeNull();
  });
});

describe("inferAutoAnalyzeBatchTotal (Serpent-qabe)", () => {
  it("returns explicit batch total when set", () => {
    expect(
      inferAutoAnalyzeBatchTotal(
        5,
        { queued: 2, running: 1, succeeded: 10, failed: 0 },
        { succeeded: 8, failed: 0 },
      ),
    ).toBe(5);
  });

  it("infers total from in-flight plus done delta when batch unknown", () => {
    expect(
      inferAutoAnalyzeBatchTotal(
        0,
        { queued: 2, running: 1, succeeded: 5, failed: 1 },
        { succeeded: 2, failed: 0 },
      ),
    ).toBe(7);
  });

  it("returns 0 when queue is idle and batch unknown", () => {
    expect(
      inferAutoAnalyzeBatchTotal(
        0,
        { queued: 0, running: 0, succeeded: 3, failed: 0 },
        { succeeded: 0, failed: 0 },
      ),
    ).toBe(0);
  });
});

describe("collectRecentAiFailureCodes (Serpent-iokf)", () => {
  it("returns distinct failed codes in encounter order", () => {
    expect(
      collectRecentAiFailureCodes([
        { status: "failed", errorCode: "AI_AUTH" },
        { status: "succeeded", errorCode: null },
        { status: "failed", errorCode: "AI_AUTH" },
        { status: "failed", errorCode: "THUMBNAIL_REQUIRED" },
        { status: "failed", errorCode: "AI_NETWORK" },
      ]),
    ).toEqual(["AI_AUTH", "THUMBNAIL_REQUIRED", "AI_NETWORK"]);
  });
});
