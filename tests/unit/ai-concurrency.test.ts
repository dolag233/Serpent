import { describe, expect, it } from "vitest";

import {
  AI_ANALYSIS_CONCURRENCY_MAX,
  DEFAULT_AI_ANALYSIS_CONCURRENCY,
  resolveAiAnalysisConcurrency,
} from "../../src/shared/ai-concurrency";

describe("resolveAiAnalysisConcurrency (Serpent-opme)", () => {
  it("defaults to 16", () => {
    expect(resolveAiAnalysisConcurrency(undefined)).toBe(
      DEFAULT_AI_ANALYSIS_CONCURRENCY,
    );
    expect(resolveAiAnalysisConcurrency("")).toBe(
      DEFAULT_AI_ANALYSIS_CONCURRENCY,
    );
  });

  it("clamps to 1..32", () => {
    expect(resolveAiAnalysisConcurrency("0")).toBe(1);
    expect(resolveAiAnalysisConcurrency("8")).toBe(8);
    expect(resolveAiAnalysisConcurrency("99")).toBe(
      AI_ANALYSIS_CONCURRENCY_MAX,
    );
  });
});
