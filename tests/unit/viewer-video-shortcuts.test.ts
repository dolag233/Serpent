import { describe, expect, it } from "vitest";

import { matchViewerVideoLetterShortcut } from "../../src/shared/viewer-video-shortcuts";

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
});
