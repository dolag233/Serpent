import { describe, expect, it } from "vitest";

import {
  DEFAULT_AI_ANALYSIS_CONCURRENCY,
  resolveAiAnalysisConcurrency,
} from "../../src/shared/ai-concurrency";

describe("resolveAiAnalysisConcurrency (Serpent-opme)", () => {
  it("defaults to 4", () => {
    expect(resolveAiAnalysisConcurrency(undefined)).toBe(
      DEFAULT_AI_ANALYSIS_CONCURRENCY,
    );
    expect(resolveAiAnalysisConcurrency("")).toBe(
      DEFAULT_AI_ANALYSIS_CONCURRENCY,
    );
  });

  it("clamps to 1..16", () => {
    expect(resolveAiAnalysisConcurrency("0")).toBe(1);
    expect(resolveAiAnalysisConcurrency("8")).toBe(8);
    expect(resolveAiAnalysisConcurrency("99")).toBe(16);
  });
});
