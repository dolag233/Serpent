import { describe, expect, it, vi } from "vitest";

import { ensureRendererKeyboardFocus } from "../../src/main/renderer-keyboard-focus";

function createWindow(overrides?: {
  readonly destroyed?: boolean;
  readonly minimized?: boolean;
  readonly focused?: boolean;
}) {
  return {
    isDestroyed: () => overrides?.destroyed === true,
    isMinimized: () => overrides?.minimized === true,
    isFocused: () => overrides?.focused !== false,
    restore: vi.fn(),
    show: vi.fn(),
    moveTop: vi.fn(),
    blur: vi.fn(),
    focus: vi.fn(),
    getNativeWindowHandle: vi.fn(() => Buffer.alloc(8)),
    webContents: { focus: vi.fn(), isFocused: () => true },
  };
}

describe("ensureRendererKeyboardFocus", () => {
  it("no-ops when the window is missing or destroyed", () => {
    expect(ensureRendererKeyboardFocus(null)).toBe(false);
    const destroyed = createWindow({ destroyed: true });
    expect(ensureRendererKeyboardFocus(destroyed)).toBe(false);
    expect(destroyed.focus).not.toHaveBeenCalled();
  });

  it("focuses webContents immediately off Windows", () => {
    const window = createWindow({ focused: true });
    const stealNativeForeground = vi.fn(() => false);
    expect(
      ensureRendererKeyboardFocus(window, {
        platform: "darwin",
        stealAppFocus: () => undefined,
        stealNativeForeground,
      }),
    ).toBe(true);
    expect(stealNativeForeground).toHaveBeenCalledTimes(1);
    expect(window.blur).not.toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.webContents.focus).toHaveBeenCalledTimes(1);
  });

  it("restores a minimized window before focusing", () => {
    const window = createWindow({ minimized: true, focused: false });
    ensureRendererKeyboardFocus(window, {
      platform: "darwin",
      stealAppFocus: () => undefined,
      stealNativeForeground: () => false,
    });
    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it("steals foreground once unless HWND reattach is requested", () => {
    const window = createWindow({ focused: true });
    const stealAppFocus = vi.fn();
    const stealNativeForeground = vi.fn(() => true);
    expect(
      ensureRendererKeyboardFocus(window, {
        platform: "win32",
        stealAppFocus,
        stealNativeForeground,
      }),
    ).toBe(true);
    expect(window.blur).not.toHaveBeenCalled();
    expect(stealAppFocus).toHaveBeenCalledTimes(1);
    expect(stealNativeForeground).toHaveBeenCalledTimes(1);
    expect(window.moveTop).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.webContents.focus).toHaveBeenCalledTimes(1);
  });

  it("blurs an already-focused Windows window after a native modal, then steals", () => {
    const window = createWindow({ focused: true });
    const stealAppFocus = vi.fn();
    const stealNativeForeground = vi.fn(() => true);
    const scheduled: Array<() => void> = [];
    expect(
      ensureRendererKeyboardFocus(window, {
        platform: "win32",
        reattachHwnd: true,
        stealAppFocus,
        stealNativeForeground,
        schedule: (callback) => {
          scheduled.push(callback);
        },
      }),
    ).toBe(true);
    expect(window.blur).toHaveBeenCalledTimes(1);
    expect(stealNativeForeground).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    expect(stealAppFocus).toHaveBeenCalledTimes(1);
    expect(stealNativeForeground).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.webContents.focus).toHaveBeenCalledTimes(1);
  });
});
