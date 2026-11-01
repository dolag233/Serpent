// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";

import {
  formatRuntimeShortcut,
  matchesRuntimeShortcut,
  listenForShortcutInputs,
  setShortcutRuntime,
} from "../../src/renderer/shortcut-runtime";
import {
  DEFAULT_SHORTCUT_BINDINGS,
  setShortcutOverride,
} from "../../src/shared/shortcut-bindings";
import { matchVideoPlaybackSeekKey } from "../../src/renderer/video-player-controls";

const event = (key: string, code: string) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
});

afterEach(() => {
  setShortcutRuntime("windows", DEFAULT_SHORTCUT_BINDINGS);
});

describe("shortcut runtime", () => {
  it("routes matchers and menu labels through the current override", () => {
    const bindings = setShortcutOverride(
      DEFAULT_SHORTCUT_BINDINGS,
      "windows",
      "asset.rename",
      { key: "F3", code: "F3" },
    );
    setShortcutRuntime("windows", bindings);

    expect(formatRuntimeShortcut("asset.rename", "windows")).toBe("F3");
    expect(matchesRuntimeShortcut("asset.rename", event("F3", "F3"), "windows")).toBe(true);
    expect(matchesRuntimeShortcut("asset.rename", event("F2", "F2"), "windows")).toBe(false);
    expect(matchesRuntimeShortcut("not-a-catalog-action", event("F3", "F3"), "windows")).toBeNull();
  });

  it("routes real mouse side-button events through the same runtime matcher", () => {
    const bindings = setShortcutOverride(
      DEFAULT_SHORTCUT_BINDINGS,
      "windows",
      "asset.rename",
      { key: "MouseBack", altKey: true },
    );
    setShortcutRuntime("windows", bindings);
    const seen: Array<{ input: unknown; event: Event }> = [];
    const remove = listenForShortcutInputs(window, (input, event) => {
      seen.push({ input, event });
    });
    const event = new MouseEvent("mousedown", {
      button: 3,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    remove();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.event).toBe(event);
    expect(seen[0]?.input).toMatchObject({
      kind: "mouse",
      button: 3,
      altKey: true,
    });
    expect(matchesRuntimeShortcut("asset.rename", seen[0]!.input as never, "windows"))
      .toBe(true);
  });

  it.each([false, true])("preserves native keyboard prototype fields when a viewer spreads the input (repeat: %s)", (repeat) => {
    const fields = {
      key: "ArrowRight",
      code: "ArrowRight",
      keyCode: 39,
      location: 0,
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      repeat,
      isComposing: false,
    };
    const keyboardEvent = new KeyboardEvent("keydown", {
      ...fields, bubbles: true, cancelable: true,
    });
    // happy-dom may expose own data properties; Chromium exposes prototype
    // getters. Model that native shape explicitly to catch accidental spread.
    const prototype = Object.create(Object.getPrototypeOf(keyboardEvent));
    for (const [name, value] of Object.entries(fields)) {
      Reflect.deleteProperty(keyboardEvent, name);
      Object.defineProperty(prototype, name, { get: () => value, enumerable: true });
    }
    Object.setPrototypeOf(keyboardEvent, prototype);
    expect(Object.hasOwn(keyboardEvent, "key")).toBe(false);
    expect({ ...keyboardEvent }).not.toHaveProperty("key");

    const seen: Array<{ input: unknown; original: Event; action: unknown }> = [];
    const remove = listenForShortcutInputs(window, (input, original) => {
      const viewerInput = { ...input, target: original.target };
      seen.push({ input: viewerInput, original, action: matchVideoPlaybackSeekKey(viewerInput) });
      original.preventDefault();
    });
    try {
      window.dispatchEvent(keyboardEvent);
      expect(seen).toHaveLength(1);
      expect(seen[0]?.input).toMatchObject({ ...fields, kind: "keyboard" });
      expect(seen[0]?.action).toEqual(repeat ? null : { kind: "skip", direction: 1 });
      expect(seen[0]?.original).toBe(keyboardEvent);
      expect(keyboardEvent.defaultPrevented).toBe(true);
    } finally {
      remove();
    }
  });
});
