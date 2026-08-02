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
        phase: "  Processing  ",
        message: "  image 02  ",
      }),
    ).toBe("Processing · image 02");
    expect(
      formatPluginJobProgressMessage({
        completed: 1,
        total: 2,
        progress: 0.5,
        phase: "",
        message: "   ",
      }),
    ).toBe("");
  });
});
