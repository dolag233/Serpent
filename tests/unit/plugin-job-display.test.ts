import { describe, expect, it } from "vitest";

import {
  formatPluginJobError,
  formatPluginJobProgressMessage,
  formatPluginJobProgressSummary,
  getPluginJobDisplayProgress,
} from "../../src/renderer/plugin-job-display";

describe("plugin job display", () => {
  it("calculates the percentage from authoritative counters", () => {
    expect(
      formatPluginJobProgressSummary({
        completed: 3,
        total: 10,
        progress: 0.3,
        status: "running",
        phase: "infer",
        message: "",
      }),
    ).toBe("3/10 · 30%");
  });

  it("ignores an inconsistent progress projection when total is non-zero", () => {
    expect(
      getPluginJobDisplayProgress({ completed: 3, total: 10, progress: 1 }),
    ).toBe(0.3);
    expect(
      formatPluginJobProgressSummary({
        completed: 3,
        total: 10,
        progress: 1,
        status: "running",
        phase: "infer",
        message: "",
      }),
    ).toBe("3/10 · 30%");
  });

  it("uses the projection for zero-total and unknown-total jobs", () => {
    expect(
      getPluginJobDisplayProgress({ completed: 0, total: 0, progress: 0.42 }),
    ).toBe(0.42);
    expect(
      formatPluginJobProgressSummary({
        completed: 0,
        total: 0,
        progress: 0.42,
        status: "running",
        phase: "",
        message: "",
      }),
    ).toBe("0/0 · 42%");
    expect(
      getPluginJobDisplayProgress({
        completed: undefined,
        total: undefined,
        progress: 0.42,
      }),
    ).toBe(0.42);
  });

  it("combines phase and custom message while ignoring blank values", () => {
    expect(
      formatPluginJobProgressMessage({
        completed: 1,
        total: 2,
        progress: 0.5,
        status: "running",
        phase: "  Processing  ",
        message: "  image 02  ",
      }),
    ).toBe("Processing · image 02");
    expect(
      formatPluginJobProgressMessage({
        completed: 1,
        total: 2,
        progress: 0.5,
        status: "running",
        phase: "",
        message: "   ",
      }),
    ).toBe("");
  });

  it("does not show stale running text for a queued job", () => {
    expect(
      formatPluginJobProgressMessage({
        completed: 0,
        total: 1,
        progress: 0,
        status: "queued",
        phase: "reading",
        message: "读取资产 image.png",
      }),
    ).toBe("");
  });

  it("redacts host paths and bounds plugin failure text", () => {
    expect(
      formatPluginJobError(
        "Failed to read /Users/dolag/Library/Application Support/Serpent/cache/image.png",
        "READ_FAILED",
      ),
    ).toBe("Failed to read <path>");
    expect(formatPluginJobError(undefined, "READ_FAILED")).toBe("READ_FAILED");
    expect(formatPluginJobError("x".repeat(300), "READ_FAILED")).toHaveLength(240);
  });
});
