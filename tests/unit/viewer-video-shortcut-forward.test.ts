import { describe, expect, it, beforeEach } from "vitest";

import {
  resetViewerVideoShortcutForwardForTests,
  shouldForwardViewerVideoShortcut,
} from "../../src/shared/viewer-video-shortcut-dedupe";

describe("shouldForwardViewerVideoShortcut", () => {
  beforeEach(() => {
    resetViewerVideoShortcutForwardForTests();
  });

  it("allows the first action", () => {
    expect(shouldForwardViewerVideoShortcut("frame-next", 1000)).toBe(true);
  });

  it("dedupes the same action within 50ms (Menu + before-input)", () => {
    expect(shouldForwardViewerVideoShortcut("frame-next", 1000)).toBe(true);
    expect(shouldForwardViewerVideoShortcut("frame-next", 1020)).toBe(false);
    expect(shouldForwardViewerVideoShortcut("frame-next", 1060)).toBe(true);
  });

  it("allows a different action immediately", () => {
    expect(shouldForwardViewerVideoShortcut("frame-next", 1000)).toBe(true);
    expect(shouldForwardViewerVideoShortcut("frame-prev", 1005)).toBe(true);
  });
});
