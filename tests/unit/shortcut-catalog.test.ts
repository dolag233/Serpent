import { describe, expect, it } from "vitest";

import { assetCommandDefinitions } from "../../src/renderer/commands/asset-commands";
import { sidebarCommandDefinitions } from "../../src/renderer/commands/sidebar-commands";
import { toolbarCommandDefinitions } from "../../src/renderer/commands/toolbar-commands";
import {
  SHORTCUT_ACTIONS,
  findShortcutAction,
  shortcutScopesOverlap,
} from "../../src/shared/shortcut-catalog";
import {
  formatElectronAccelerator,
  formatShortcutChord,
  matchesActionShortcut,
  validateShortcutChord,
} from "../../src/shared/shortcut-resolution";

const definitionById = new Map(
  [
    ...assetCommandDefinitions,
    ...sidebarCommandDefinitions,
    ...toolbarCommandDefinitions,
  ].map((definition) => [definition.id, definition]),
);

describe("shortcut catalog", () => {
  it("supports recording a modified wheel for image zoom without creating a native accelerator", () => {
    const wheel = { key: "Wheel", altKey: true };
    expect(validateShortcutChord(wheel, "windows", ["viewer.image"], "viewer.image.wheel-zoom")).toBeNull();
    expect(validateShortcutChord(wheel, "windows", ["browse"], "asset.select-next")).toBe("mouse-button");
    expect(validateShortcutChord({ key: "A" }, "windows", ["viewer.image"], "viewer.image.wheel-zoom")).toBe("mouse-button");
    expect(formatElectronAccelerator(wheel, "windows")).toBeNull();
    expect(formatShortcutChord(wheel, "windows", { wheel: "滚轮" })).toBe("Alt+滚轮");
  });
  it("has unique ids and both platform defaults", () => {
    const ids = SHORTCUT_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const action of SHORTCUT_ACTIONS) {
      expect(action.defaults.mac.length, action.id).toBeGreaterThan(0);
      expect(action.defaults.windows.length, action.id).toBeGreaterThan(0);
      expect(findShortcutAction(action.id)).toBe(action);
    }
  });

  it("matches the command-definition defaults for every shared action", () => {
    for (const action of SHORTCUT_ACTIONS) {
      const definition = definitionById.get(action.id);
      if (definition?.shortcut === undefined) continue;
      expect(
        formatShortcutChord(action.defaults.mac[0]!, "mac"),
        action.id,
      ).toBe(definition.shortcut.mac?.label);
      expect(
        formatShortcutChord(action.defaults.windows[0]!, "windows"),
        action.id,
      ).toBe(definition.shortcut.windows?.label);
    }
  });

  it("keeps folder and collection sidebar scopes independent", () => {
    expect(shortcutScopesOverlap(["app"], ["browse"])).toBe(true);
    expect(shortcutScopesOverlap(["browse"], ["sidebar.folder"])).toBe(false);
    expect(shortcutScopesOverlap(["sidebar.folder"], ["sidebar.collection"])).toBe(false);
    expect(shortcutScopesOverlap(["sidebar.folder"], ["sidebar.folder"])).toBe(true);
  });

  it("opens the agreed R2 application and viewer actions for customization", () => {
    for (const actionId of [
      "edit.undo",
      "edit.redo",
      "asset.copy",
      "asset.paste",
      "selection.select-all",
      "selection.invert",
      "canvas.zoom-in",
      "canvas.zoom-out",
      "canvas.zoom-reset",
      "window.toggle-fullscreen",
      "viewer.previous",
      "viewer.next",
      "viewer.media.play-pause",
      "viewer.video.frame-prev",
      "viewer.video.frame-next",
      "viewer.video.rate-slower",
      "viewer.video.rate-faster",
      "viewer.video.seek-back",
      "viewer.video.seek-forward",
      "viewer.volume-up",
      "viewer.volume-down",
      "viewer.fit",
    ]) {
      expect(findShortcutAction(actionId)?.customizable, actionId).toBe(true);
    }
    expect(findShortcutAction("window.toggle-fullscreen")?.customizable).toBe(true);
    expect(findShortcutAction("viewer.close")?.customizable).toBe(false);
    expect(findShortcutAction("viewer.previous")?.customizable).toBe(true);
    expect(findShortcutAction("viewer.next")?.customizable).toBe(true);
  });

  it("formats punctuation and numpad zoom aliases as valid Electron accelerators", () => {
    expect(formatElectronAccelerator({ key: "+", code: "Equal", ctrlKey: true, shiftKey: true }, "windows"))
      .toBe("Ctrl+Shift+Plus");
    expect(formatElectronAccelerator({ key: "Add", code: "NumpadAdd", ctrlKey: true }, "windows"))
      .toBe("Ctrl+numadd");
    expect(formatElectronAccelerator({ key: "Subtract", code: "NumpadSubtract", metaKey: true }, "mac"))
      .toBe("Cmd+numsub");
  });

  it("does not serialize mouse side-button chords as Electron accelerators", () => {
    expect(formatElectronAccelerator({ key: "MouseBack", ctrlKey: true }, "windows"))
      .toBeNull();
    expect(formatElectronAccelerator({ key: "MouseForward", metaKey: true }, "mac"))
      .toBeNull();
  });

  it("rejects repeated events in the shared shortcut matcher", () => {
    expect(matchesActionShortcut("edit.undo", {
      key: "z",
      code: "KeyZ",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      repeat: true,
    }, "windows", {
      version: 1,
      platforms: { mac: {}, windows: {} },
    })).toBe(false);
  });

  it("matches modified mouse side-button chords without keyboard coercion", () => {
    const bindings = {
      version: 1 as const,
      platforms: {
        mac: {},
        windows: {
          "asset.rename": { key: "MouseBack", ctrlKey: true },
        },
      },
    };
    expect(matchesActionShortcut("asset.rename", {
      kind: "mouse",
      button: 3,
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    }, "windows", bindings)).toBe(true);
    expect(matchesActionShortcut("asset.rename", {
      kind: "mouse",
      button: 4,
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    }, "windows", bindings)).toBe(false);
    expect(matchesActionShortcut("asset.rename", {
      kind: "mouse",
      button: 3,
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      repeat: true,
    }, "windows", bindings)).toBe(false);
    expect(matchesActionShortcut("asset.rename", {
      key: "MouseBack",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    }, "windows", bindings)).toBe(false);
  });

  it("requires a modifier for mouse side-button bindings", () => {
    expect(validateShortcutChord({ key: "MouseBack" }, "windows", ["browse"]))
      .toBe("mouse-modifier-required");
    expect(validateShortcutChord({ key: "MouseBack", shiftKey: true }, "windows", ["browse"]))
      .toBeNull();
  });

  it("keeps viewer media and image scopes separate from browse and text editing", () => {
    expect(shortcutScopesOverlap(["viewer.video"], ["viewer.audio"])).toBe(false);
    expect(shortcutScopesOverlap(["viewer.base"], ["viewer.video"])).toBe(true);
    expect(shortcutScopesOverlap(["viewer.video"], ["viewer.image"])).toBe(false);
    expect(shortcutScopesOverlap(["viewer.video"], ["browse"])).toBe(false);
  });
});
