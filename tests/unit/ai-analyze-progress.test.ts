import { describe, expect, it } from "vitest";

import {
  cancellationAffectsAiBatch,
  collectRecentAiFailureCodes,
  computeAiBatchProgressForJobs,
  computeAiBatchProgress,
  progressFromAiProgressEvent,
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

  it("starts a new batch at zero even when the library has historical outcomes", () => {
    const snapshot = computeAiBatchProgressForJobs(
      ["job-new-1", "job-new-2", "job-new-3", "job-new-4", "job-new-5"],
      [
        { jobId: "job-old-success", status: "succeeded" },
        { jobId: "job-old-failed", status: "failed" },
        { jobId: "job-new-1", status: "queued" },
        { jobId: "job-new-2", status: "queued" },
        { jobId: "job-new-3", status: "queued" },
        { jobId: "job-new-4", status: "queued" },
        { jobId: "job-new-5", status: "queued" },
      ],
    );

    expect(snapshot).toMatchObject({
      batchTotal: 5,
      done: 0,
      succeeded: 0,
      failed: 0,
      queued: 5,
      running: 0,
      ratio: 0,
    });
  });

  it("counts only the selected batch's terminal jobs", () => {
    const snapshot = computeAiBatchProgressForJobs(
      ["job-new-1", "job-new-2", "job-new-3"],
      [
        { jobId: "job-old-success", status: "succeeded" },
        { jobId: "job-old-failed", status: "failed" },
        { jobId: "job-new-1", status: "succeeded" },
        { jobId: "job-new-2", status: "failed" },
        { jobId: "job-new-3", status: "running" },
      ],
    );

    expect(snapshot).toMatchObject({
      batchTotal: 3,
      done: 2,
      succeeded: 1,
      failed: 1,
      queued: 0,
      running: 1,
    });
  });

  it("counts skipped selected assets as one terminal outcome each", () => {
    const snapshot = computeAiBatchProgressForJobs(
      ["job-new-1", "job-new-2", "job-new-3", "job-new-4"],
      [
        { jobId: "job-new-1", status: "queued" },
        { jobId: "job-new-2", status: "queued" },
        { jobId: "job-new-3", status: "queued" },
        { jobId: "job-new-4", status: "queued" },
      ],
      { skipped: 1 },
    );

    expect(snapshot).toMatchObject({ batchTotal: 5, done: 1, skipped: 1, ratio: 0.2 });
  });
});

describe("progressFromAiProgressEvent (Serpent-f01d8e)", () => {
  it("advances done from progress-event job updates without a status snapshot", () => {
    const first = progressFromAiProgressEvent({
      jobIds: ["job-1", "job-2", "job-3"],
      knownJobs: [],
      changedJobs: [{ jobId: "job-1", status: "succeeded" }],
      baseline: { succeeded: 40, failed: 9 },
      counters: { queued: 2, running: 1, succeeded: 40, failed: 9 },
    });
    expect(first.progress).toMatchObject({ batchTotal: 3, done: 1, succeeded: 1, ratio: 1 / 3 });

    const second = progressFromAiProgressEvent({
      jobIds: ["job-1", "job-2", "job-3"],
      knownJobs: first.knownJobs,
      changedJobs: [{ jobId: "job-2", status: "failed", errorCode: "AI_RATE_LIMIT" }],
      baseline: { succeeded: 40, failed: 9 },
      counters: { queued: 1, running: 1, succeeded: 40, failed: 10 },
    });
    expect(second.progress).toMatchObject({ done: 2, succeeded: 1, failed: 1, ratio: 2 / 3 });
  });

  it("ignores jobs from other actions and falls back to counter deltas", () => {
    const snapshot = progressFromAiProgressEvent({
      jobIds: ["job-new"],
      knownJobs: [],
      changedJobs: [{ jobId: "job-old", status: "succeeded" }],
      skipped: 0,
      baseline: { succeeded: 10, failed: 0 },
      counters: { queued: 0, running: 1, succeeded: 11, failed: 0 },
    });
    expect(snapshot.knownJobs).toEqual([]);
    expect(snapshot.progress).toMatchObject({ batchTotal: 1, done: 1, succeeded: 1 });
  });
});

describe("cancellationAffectsAiBatch", () => {
  it("does not let unrelated panel jobs erase active batch tracking", () => {
    expect(cancellationAffectsAiBatch(["job-1", "job-2"], ["job-old"])).toBe(false);
    expect(cancellationAffectsAiBatch(["job-1", "job-2"], ["job-2"])).toBe(true);
    expect(cancellationAffectsAiBatch(["job-1", "job-2"])).toBe(true);
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
