import { describe, expect, it } from "vitest";

import {
  formatPluginJobProgressMessage,
  formatPluginJobProgressSummary,
} from "../../src/renderer/plugin-job-display";

describe("plugin job display", () => {
  it("shows authoritative item counts with the projected percentage", () => {
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
});
