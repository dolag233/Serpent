import { describe, expect, it } from "vitest";

import {
  parseWindowControlRequest,
  parseWindowControlResult,
  parseWindowMaximizedStateEvent,
  shouldHideApplicationMenuBar,
  shouldHideWindowOnClose,
  shouldUseFramelessTitleBar,
} from "../../src/shared/window-controls";

describe("window-controls protocol (Serpent-znex)", () => {
  it("parses known caption actions and rejects junk", () => {
    expect(parseWindowControlRequest({ action: "minimize" })).toEqual({
      action: "minimize",
    });
    expect(parseWindowControlRequest({ action: "maximize-toggle" })).toEqual({
      action: "maximize-toggle",
    });
    expect(parseWindowControlRequest({ action: "close" })).toEqual({
      action: "close",
    });
    expect(parseWindowControlRequest({ action: "get-state" })).toEqual({
      action: "get-state",
    });
    expect(parseWindowControlRequest({ action: "explode" })).toBeNull();
    expect(parseWindowControlRequest({})).toBeNull();
  });

  it("parses control results and falls back on malformed payloads", () => {
    expect(parseWindowControlResult({ ok: true, maximized: true })).toEqual({
      ok: true,
      maximized: true,
    });
    expect(
      parseWindowControlResult({ ok: false, code: "unauthorized_sender" }),
    ).toEqual({ ok: false, code: "unauthorized_sender" });
    expect(parseWindowControlResult({ ok: true })).toEqual({
      ok: false,
      code: "malformed_request",
    });
  });

  it("parses maximize state events", () => {
    expect(
      parseWindowMaximizedStateEvent({
        type: "shell.window.maximized",
        maximized: false,
      }),
    ).toEqual({ type: "shell.window.maximized", maximized: false });
    expect(parseWindowMaximizedStateEvent({ maximized: true })).toBeNull();
  });

  it("enables frameless title bar and hidden menu only on Windows", () => {
    expect(shouldUseFramelessTitleBar("win32")).toBe(true);
    expect(shouldHideApplicationMenuBar("win32")).toBe(true);
    expect(shouldUseFramelessTitleBar("darwin")).toBe(false);
    expect(shouldHideApplicationMenuBar("darwin")).toBe(false);
    expect(shouldUseFramelessTitleBar("linux")).toBe(false);
    expect(shouldHideApplicationMenuBar("linux")).toBe(false);
  });

  it("hides the Windows window for the tray instead of quitting", () => {
    expect(shouldHideWindowOnClose("win32")).toBe(true);
    expect(shouldHideWindowOnClose("darwin")).toBe(false);
    expect(shouldHideWindowOnClose("linux")).toBe(false);
  });
});
