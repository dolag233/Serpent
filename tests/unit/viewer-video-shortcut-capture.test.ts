import type { WebContents } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  window: {},
  token: { hwnd: 1n, previousHimc: 2n, previousOpen: true },
  fromWebContents: vi.fn(),
  suspend: vi.fn(),
  restore: vi.fn(),
  setMenuActive: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: { fromWebContents: native.fromWebContents },
}));
vi.mock("../../src/main/windows-ime", () => ({
  suspendWindowsIme: native.suspend,
  restoreWindowsIme: native.restore,
}));
vi.mock("../../src/main/viewer-video-shortcut-menu", () => ({
  setViewerVideoShortcutMenuActive: native.setMenuActive,
}));

import {
  clearViewerVideoShortcutCapture,
  isViewerVideoShortcutContentsActive,
  resetViewerVideoShortcutCaptureForTests,
  setViewerVideoShortcutCaptureActive,
  viewerShortcutScopeForContents,
} from "../../src/main/viewer-video-shortcut-capture";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  setShortcutOverride,
} from "../../src/shared/shortcut-bindings";

const contents = { id: 1 } as WebContents;

beforeEach(() => {
  vi.clearAllMocks();
  native.fromWebContents.mockReturnValue(native.window);
  native.suspend.mockReturnValue(native.token);
});

afterEach(() => {
  resetViewerVideoShortcutCaptureForTests();
});

describe("viewer shortcut capture IME policy", () => {
  it("keeps video capture functional without suspending IME, including repeated focus cycles", () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      setViewerVideoShortcutCaptureActive(contents, true);
      expect(isViewerVideoShortcutContentsActive(contents.id)).toBe(true);
      expect(viewerShortcutScopeForContents(contents.id)).toBe("viewer.video");
      expect(native.setMenuActive).toHaveBeenCalledWith(true, "viewer.video");
      setViewerVideoShortcutCaptureActive(contents, false);
      expect(isViewerVideoShortcutContentsActive(contents.id)).toBe(false);
    }

    expect(native.suspend).not.toHaveBeenCalled();
    expect(native.fromWebContents).not.toHaveBeenCalled();
    // restoreWindowsIme(null) is a no-op; no native context may be restored.
    expect(native.restore.mock.calls.every(([token]) => token === null)).toBe(true);
  });

  it("still permits explicit suspension and restores the original context once when disarmed", () => {
    for (let activation = 0; activation < 2; activation += 1) {
      setViewerVideoShortcutCaptureActive(contents, true, DEFAULT_SHORTCUT_BINDINGS, "viewer.video", true);
    }
    expect(native.suspend).toHaveBeenCalledExactlyOnceWith(native.window);

    native.restore.mockClear();
    setViewerVideoShortcutCaptureActive(contents, false);
    clearViewerVideoShortcutCapture(contents.id);
    expect(native.restore).toHaveBeenCalledExactlyOnceWith(native.token);
    expect(viewerShortcutScopeForContents(contents.id)).toBeNull();
  });

  it("restores a previously suspended context when active video capture returns to the default policy", () => {
    setViewerVideoShortcutCaptureActive(contents, true, DEFAULT_SHORTCUT_BINDINGS, "viewer.video", true);
    native.restore.mockClear();

    setViewerVideoShortcutCaptureActive(contents, true);
    setViewerVideoShortcutCaptureActive(contents, true);
    expect(native.restore).toHaveBeenCalledExactlyOnceWith(native.token);
    expect(native.suspend).toHaveBeenCalledTimes(1);
    expect(isViewerVideoShortcutContentsActive(contents.id)).toBe(true);
  });

  it("preserves audio's bare-letter capture policy and releases its context when switching to video", () => {
    let bindings = DEFAULT_SHORTCUT_BINDINGS;
    for (const platform of ["mac", "windows"] as const) {
      bindings = setShortcutOverride(bindings, platform, "viewer.media.play-pause", {
        key: "p", code: "KeyP",
      });
    }
    setViewerVideoShortcutCaptureActive(contents, true, bindings, "viewer.audio");
    expect(native.suspend).toHaveBeenCalledExactlyOnceWith(native.window);
    expect(viewerShortcutScopeForContents(contents.id)).toBe("viewer.audio");

    native.restore.mockClear();
    setViewerVideoShortcutCaptureActive(contents, true, bindings, "viewer.video");
    expect(native.restore).toHaveBeenCalledExactlyOnceWith(native.token);
    expect(native.suspend).toHaveBeenCalledTimes(1);
    expect(viewerShortcutScopeForContents(contents.id)).toBe("viewer.video");
  });

  it("restores a suspended context when its web contents is cleared", () => {
    setViewerVideoShortcutCaptureActive(contents, true, DEFAULT_SHORTCUT_BINDINGS, "viewer.video", true);
    native.restore.mockClear();

    clearViewerVideoShortcutCapture(contents.id);
    clearViewerVideoShortcutCapture(contents.id);
    expect(native.restore).toHaveBeenCalledExactlyOnceWith(native.token);
    expect(isViewerVideoShortcutContentsActive(contents.id)).toBe(false);
  });
});
