import { describe, expect, it } from "vitest";

import {
  CARD_SIZE_MAX,
  CARD_SIZE_MIN,
  DEFAULT_CANVAS_PREFERENCES,
} from "../../src/renderer/canvas-preferences";
import {
  GLOBAL_KEYBOARD_ZOOM_FACTOR,
  defaultKeyboardCardSize,
  matchGlobalZoomShortcut,
  nextKeyboardCardSize,
  nextKeyboardZoomScale,
  shouldIgnoreGlobalZoomShortcut,
  type GlobalZoomShortcutEvent,
} from "../../src/renderer/global-zoom-shortcuts";

const event = (
  overrides: Partial<GlobalZoomShortcutEvent>,
): GlobalZoomShortcutEvent => ({
  key: "",
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

describe("matchGlobalZoomShortcut", () => {
  it("mac: Cmd+= / Cmd++ zoom in, Cmd+- out, Cmd+0 reset", () => {
    expect(
      matchGlobalZoomShortcut(event({ key: "=", metaKey: true }), "mac"),
    ).toBe("in");
    expect(
      matchGlobalZoomShortcut(
        event({ key: "+", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe("in");
    expect(
      matchGlobalZoomShortcut(event({ key: "-", metaKey: true }), "mac"),
    ).toBe("out");
    expect(
      matchGlobalZoomShortcut(event({ key: "0", metaKey: true }), "mac"),
    ).toBe("reset");
  });

  it("windows: Ctrl chords; rejects meta / wrong platform modifier", () => {
    expect(
      matchGlobalZoomShortcut(event({ key: "=", ctrlKey: true }), "windows"),
    ).toBe("in");
    expect(
      matchGlobalZoomShortcut(event({ key: "=", metaKey: true }), "mac"),
    ).toBe("in");
    expect(
      matchGlobalZoomShortcut(event({ key: "=", ctrlKey: true }), "mac"),
    ).toBe(null);
    expect(
      matchGlobalZoomShortcut(event({ key: "=", metaKey: true }), "windows"),
    ).toBe(null);
  });

  it("rejects Alt and Shift+= (but allows Shift++ for zoom in)", () => {
    expect(
      matchGlobalZoomShortcut(
        event({ key: "=", metaKey: true, altKey: true }),
        "mac",
      ),
    ).toBe(null);
    expect(
      matchGlobalZoomShortcut(
        event({ key: "=", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe(null);
    expect(
      matchGlobalZoomShortcut(
        event({ key: "0", metaKey: true, shiftKey: true }),
        "mac",
      ),
    ).toBe(null);
  });

  it("accepts numpad Add/Subtract aliases", () => {
    expect(
      matchGlobalZoomShortcut(event({ key: "Add", metaKey: true }), "mac"),
    ).toBe("in");
    expect(
      matchGlobalZoomShortcut(
        event({ key: "Subtract", ctrlKey: true }),
        "windows",
      ),
    ).toBe("out");
  });
});

describe("keyboard zoom / card-size steps", () => {
  it("uses the shared wheel-equivalent factor", () => {
    expect(GLOBAL_KEYBOARD_ZOOM_FACTOR).toBeCloseTo(Math.exp(0.2), 10);
    expect(nextKeyboardZoomScale(1, "in")).toBeCloseTo(
      Math.exp(0.2),
      10,
    );
    expect(nextKeyboardZoomScale(Math.exp(0.2), "out")).toBeCloseTo(1, 10);
  });

  it("clamps viewer scale to the fit helpers’ range", () => {
    expect(nextKeyboardZoomScale(8, "in")).toBe(8);
    expect(nextKeyboardZoomScale(0.05, "out")).toBe(0.05);
  });

  it("steps and clamps browse card size; reset target is default", () => {
    expect(defaultKeyboardCardSize()).toBe(
      DEFAULT_CANVAS_PREFERENCES.cardSize,
    );
    const stepped = nextKeyboardCardSize(160, "in");
    expect(stepped).toBeGreaterThan(160);
    expect(stepped).toBeLessThanOrEqual(CARD_SIZE_MAX);
    expect(nextKeyboardCardSize(CARD_SIZE_MIN, "out")).toBe(CARD_SIZE_MIN);
    expect(nextKeyboardCardSize(CARD_SIZE_MAX, "in")).toBe(CARD_SIZE_MAX);
  });
});

describe("shouldIgnoreGlobalZoomShortcut", () => {
  it("ignores editable fields and dialog descendants", () => {
    expect(
      shouldIgnoreGlobalZoomShortcut({
        tagName: "INPUT",
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      shouldIgnoreGlobalZoomShortcut({
        tagName: "DIV",
        closest: (sel: string) => (sel.includes("dialog") ? {} : null),
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      shouldIgnoreGlobalZoomShortcut({
        tagName: "DIV",
        closest: () => null,
      } as unknown as EventTarget),
    ).toBe(false);
  });
});
