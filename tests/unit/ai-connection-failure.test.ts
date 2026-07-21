import { describe, expect, it } from "vitest";

import {
  INITIAL_CONNECTION_FAILURE_GATE,
  isAiConnectionFailureCode,
  listConnectionFailedJobIds,
  reduceConnectionFailureGate,
} from "../../src/renderer/ai-connection-failure";

describe("isAiConnectionFailureCode (Serpent-kdnm)", () => {
  it("accepts network / timeout / rate_limit / auth", () => {
    expect(isAiConnectionFailureCode("AI_NETWORK")).toBe(true);
    expect(isAiConnectionFailureCode("AI_TIMEOUT")).toBe(true);
    expect(isAiConnectionFailureCode("AI_RATE_LIMIT")).toBe(true);
    expect(isAiConnectionFailureCode("AI_AUTH")).toBe(true);
  });

  it("rejects invalid_response and unrelated codes", () => {
    expect(isAiConnectionFailureCode("AI_INVALID_RESPONSE")).toBe(false);
    expect(isAiConnectionFailureCode("THUMBNAIL_REQUIRED")).toBe(false);
    expect(isAiConnectionFailureCode(null)).toBe(false);
  });
});

describe("listConnectionFailedJobIds (Serpent-kdnm)", () => {
  it("returns only terminal connection-class failures", () => {
    expect(
      listConnectionFailedJobIds([
        { jobId: "a", status: "failed", errorCode: "AI_NETWORK" },
        { jobId: "b", status: "queued", errorCode: "AI_NETWORK" },
        { jobId: "c", status: "failed", errorCode: "AI_INVALID_RESPONSE" },
        { jobId: "d", status: "failed", errorCode: "AI_AUTH" },
      ]),
    ).toEqual(["a", "d"]);
  });
});

describe("reduceConnectionFailureGate (Serpent-kdnm)", () => {
  it("does not open before a batch is armed", () => {
    const state = reduceConnectionFailureGate(INITIAL_CONNECTION_FAILURE_GATE, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["j1"],
    });
    expect(state.open).toBe(false);
    expect(state.armed).toBe(false);
  });

  it("opens once for fresh connection failures after batch start", () => {
    let state = reduceConnectionFailureGate(INITIAL_CONNECTION_FAILURE_GATE, {
      type: "batch_started",
      baselineFailedJobIds: ["old"],
    });
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["old", "new1"],
    });
    expect(state.open).toBe(true);
    expect(state.failedJobIds).toEqual(["new1"]);

    const again = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["old", "new1", "new2"],
    });
    expect(again.open).toBe(true);
    expect(again.failedJobIds).toEqual(["new1", "new2"]);
    // Still one dialog — does not re-trigger open from closed.
  });

  it("does not open for baseline-only failures", () => {
    let state = reduceConnectionFailureGate(INITIAL_CONNECTION_FAILURE_GATE, {
      type: "batch_started",
      baselineFailedJobIds: ["old"],
    });
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["old"],
    });
    expect(state.open).toBe(false);
  });

  it("Retry clears prompt so a later wave can open again", () => {
    let state = reduceConnectionFailureGate(INITIAL_CONNECTION_FAILURE_GATE, {
      type: "batch_started",
      baselineFailedJobIds: [],
    });
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["j1"],
    });
    expect(state.open).toBe(true);
    state = reduceConnectionFailureGate(state, {
      type: "resolved",
      decision: "retry",
    });
    expect(state.open).toBe(false);
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["j1"],
    });
    expect(state.open).toBe(true);
  });

  it("Abort suppresses until the next batch", () => {
    let state = reduceConnectionFailureGate(INITIAL_CONNECTION_FAILURE_GATE, {
      type: "batch_started",
      baselineFailedJobIds: [],
    });
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["j1"],
    });
    state = reduceConnectionFailureGate(state, {
      type: "resolved",
      decision: "abort",
    });
    expect(state.open).toBe(false);
    expect(state.suppressedUntilNextBatch).toBe(true);
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["j2"],
    });
    expect(state.open).toBe(false);

    state = reduceConnectionFailureGate(state, {
      type: "batch_started",
      baselineFailedJobIds: [],
    });
    state = reduceConnectionFailureGate(state, {
      type: "jobs_snapshot",
      connectionFailedJobIds: ["j3"],
    });
    expect(state.open).toBe(true);
  });
});
