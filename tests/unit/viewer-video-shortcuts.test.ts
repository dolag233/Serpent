import { describe, expect, it } from "vitest";

import {
  matchViewerVideoLetterShortcut,
  viewerMainShortcutRoutes,
  viewerShortcutRepeatForward,
  viewerVideoShortcutNeedsImeSuspension,
} from "../../src/shared/viewer-video-shortcuts";
import { DEFAULT_SHORTCUT_BINDINGS } from "../../src/shared/shortcut-bindings";
import { setShortcutOverride } from "../../src/shared/shortcut-bindings";

describe("matchViewerVideoLetterShortcut (Main before-input)", () => {
  const base = {
    type: "keyDown" as const,
    control: false,
    meta: false,
    alt: false,
    shift: false,
  };

  it("maps D/F/X/C by code", () => {
    expect(matchViewerVideoLetterShortcut({ ...base, code: "KeyD" })).toBe(
      "frame-prev",
    );
    expect(matchViewerVideoLetterShortcut({ ...base, code: "KeyF" })).toBe(
      "frame-next",
    );
    expect(matchViewerVideoLetterShortcut({ ...base, code: "KeyX" })).toBe(
      "rate-slower",
    );
    expect(matchViewerVideoLetterShortcut({ ...base, code: "KeyC" })).toBe(
      "rate-faster",
    );
  });

  it("still matches when IME sets key to Process", () => {
    expect(
      matchViewerVideoLetterShortcut({
        ...base,
        code: "KeyD",
        key: "Process",
      }),
    ).toBe("frame-prev");
  });

  it("matches by keyCode when code is missing (Windows IME)", () => {
    expect(
      matchViewerVideoLetterShortcut({
        ...base,
        keyCode: 68,
        key: "Process",
      }),
    ).toBe("frame-prev");
    expect(
      matchViewerVideoLetterShortcut({
        ...base,
        keyCode: 67,
        key: "Process",
      }),
    ).toBe("rate-faster");
  });

  it("ignores modified chords (Ctrl+C copy etc.)", () => {
    expect(
      matchViewerVideoLetterShortcut({
        ...base,
        code: "KeyC",
        control: true,
      }),
    ).toBeNull();
  });

  it("ignores keyUp", () => {
    expect(
      matchViewerVideoLetterShortcut({
        ...base,
        type: "keyUp",
        code: "KeyD",
      }),
    ).toBeNull();
  });

  it("suspends Windows IME only while an effective bare viewer letter remains", () => {
    expect(viewerVideoShortcutNeedsImeSuspension(DEFAULT_SHORTCUT_BINDINGS, "windows"))
      .toBe(true);
    expect(viewerVideoShortcutNeedsImeSuspension({
      version: 1,
      platforms: {
        mac: {},
        windows: {
          "viewer.video.frame-prev": { key: "d", ctrlKey: true },
          "viewer.video.frame-next": { key: "f", ctrlKey: true },
          "viewer.video.rate-slower": { key: "x", ctrlKey: true },
          "viewer.video.rate-faster": { key: "c", ctrlKey: true },
        },
      },
    }, "windows")).toBe(false);
  });

  it("ignores repeated physical key events after the first viewer action", () => {
    expect(matchViewerVideoLetterShortcut({
      ...base,
      code: "KeyC",
      isAutoRepeat: true,
    })).toBeNull();
  });

  it("forwards held Ctrl+Arrow seeks and keeps letter repeats one-shot", () => {
    expect(viewerShortcutRepeatForward("seek-back", "seek-back")).toEqual({
      action: "seek-back",
      repeat: false,
    });
    expect(viewerShortcutRepeatForward(null, "seek-forward")).toEqual({
      action: "seek-forward",
      repeat: true,
    });
    expect(viewerShortcutRepeatForward(null, "frame-next")).toBeNull();
  });

  it("routes audio/video play-pause through the catalog even when frame/rate letters are modified", () => {
    let bindings = DEFAULT_SHORTCUT_BINDINGS;
    bindings = setShortcutOverride(bindings, "windows", "viewer.media.play-pause", {
      key: "p",
      code: "KeyP",
    });
    for (const [actionId, key] of [
      ["viewer.video.frame-prev", "d"],
      ["viewer.video.frame-next", "f"],
      ["viewer.video.rate-slower", "x"],
      ["viewer.video.rate-faster", "c"],
    ] as const) {
      bindings = setShortcutOverride(bindings, "windows", actionId, {
        key,
        code: `Key${key.toUpperCase()}`,
        ctrlKey: true,
      });
    }

    expect(viewerVideoShortcutNeedsImeSuspension(bindings, "windows", "viewer.audio"))
      .toBe(true);
    expect(viewerVideoShortcutNeedsImeSuspension(bindings, "windows", "viewer.video"))
      .toBe(true);
    expect(matchViewerVideoLetterShortcut({ ...base, code: "KeyP" }, bindings, "windows", "viewer.audio"))
      .toBe("play-pause");
    expect(matchViewerVideoLetterShortcut({ ...base, code: "KeyP" }, bindings, "windows", "viewer.video"))
      .toBe("play-pause");
    expect(viewerMainShortcutRoutes("viewer.audio").map((route) => route.action))
      .toEqual(["play-pause", "seek-back", "seek-forward"]);
    expect(viewerMainShortcutRoutes("viewer.video").map((route) => route.action))
      .toEqual([
        "play-pause",
        "frame-prev",
        "frame-next",
        "rate-slower",
        "rate-faster",
        "seek-back",
        "seek-forward",
      ]);
    expect(matchViewerVideoLetterShortcut(
      { ...base, code: "ArrowLeft", key: "ArrowLeft", control: true },
      bindings,
      "windows",
      "viewer.video",
    )).toBe("seek-back");
    expect(matchViewerVideoLetterShortcut(
      { ...base, code: "ArrowRight", key: "ArrowRight", control: true },
      bindings,
      "windows",
      "viewer.video",
    )).toBe("seek-forward");
    expect(matchViewerVideoLetterShortcut(
      { ...base, code: "ArrowLeft", key: "ArrowLeft", control: true },
      bindings,
      "windows",
      "viewer.audio",
    )).toBe("seek-back");
  });
});
