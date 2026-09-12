import { describe, expect, it } from "vitest";

import {
  captureWorkspaceNavViewport,
  resolveWorkspaceScrollTop,
} from "../../src/renderer/workspace-scroll-position";

describe("workspace scroll position", () => {
  it("captures an exact offset and its relative progress", () => {
    expect(captureWorkspaceNavViewport({
      scrollTop: 730,
      scrollHeight: 1_100,
      clientHeight: 100,
    } as HTMLElement)).toEqual({
      scrollTop: 730,
      scrollProgress: 0.73,
      scrollExtent: 1_000,
    });
  });

  it("uses the exact offset for the same extent and progress after a resize", () => {
    const viewport = {
      scrollTop: 730,
      scrollProgress: 0.73,
      scrollExtent: 1_000,
    };
    expect(resolveWorkspaceScrollTop(viewport, 1_000)).toBe(730);
    expect(resolveWorkspaceScrollTop(viewport, 2_000)).toBe(1_460);
  });
});
