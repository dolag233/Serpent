import { describe, expect, it } from "vitest";

import {
  AI_CONNECTION_HEARTBEAT_MS,
  aiAnalyzeConnectionReady,
  aiAnalyzeShowsDisconnectGlyph,
  shouldRunAiConnectionHeartbeat,
} from "../../src/renderer/ai-connection-heartbeat";

describe("ai-connection-heartbeat (Serpent-rsbt)", () => {
  it("uses a ~60s interval", () => {
    expect(AI_CONNECTION_HEARTBEAT_MS).toBe(60_000);
  });

  it("runs heartbeat only when a stored key exists", () => {
    expect(shouldRunAiConnectionHeartbeat(true)).toBe(true);
    expect(shouldRunAiConnectionHeartbeat(false)).toBe(false);
  });

  it("shows the disconnect glyph when unavailable", () => {
    expect(aiAnalyzeShowsDisconnectGlyph(false, "idle")).toBe(true);
    expect(aiAnalyzeShowsDisconnectGlyph(true, "idle")).toBe(true);
    expect(aiAnalyzeShowsDisconnectGlyph(true, "disconnected")).toBe(true);
    expect(aiAnalyzeShowsDisconnectGlyph(true, "error")).toBe(true);
    expect(aiAnalyzeShowsDisconnectGlyph(true, "connecting")).toBe(false);
    expect(aiAnalyzeShowsDisconnectGlyph(true, "connected")).toBe(false);
  });

  it("requires connected state for analyze readiness", () => {
    expect(aiAnalyzeConnectionReady(true, "connected")).toBe(true);
    expect(aiAnalyzeConnectionReady(true, "connecting")).toBe(false);
    expect(aiAnalyzeConnectionReady(true, "disconnected")).toBe(false);
    expect(aiAnalyzeConnectionReady(false, "connected")).toBe(false);
  });
});
