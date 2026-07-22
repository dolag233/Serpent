import { describe, expect, it } from "vitest";

import {
  isMarqueeAdditiveModifier,
  isMarqueeToggleModifier,
  isToggleSelectionModifier,
  resolveSelectionPlatform,
} from "../../src/renderer/selection-modifiers";

describe("resolveSelectionPlatform (Serpent-b44c)", () => {
  it("detects mac vs windows from user agent", () => {
    expect(resolveSelectionPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe(
      "mac",
    );
    expect(resolveSelectionPlatform("Mozilla/5.0 (Windows NT 10.0)")).toBe(
      "windows",
    );
  });
});

describe("isToggleSelectionModifier", () => {
  it("macOS uses metaKey only", () => {
    expect(
      isToggleSelectionModifier({ metaKey: true, ctrlKey: false }, "mac"),
    ).toBe(true);
    expect(
      isToggleSelectionModifier({ metaKey: false, ctrlKey: true }, "mac"),
    ).toBe(false);
  });

  it("Windows uses ctrlKey only", () => {
    expect(
      isToggleSelectionModifier({ metaKey: false, ctrlKey: true }, "windows"),
    ).toBe(true);
    expect(
      isToggleSelectionModifier({ metaKey: true, ctrlKey: false }, "windows"),
    ).toBe(false);
  });
});

describe("isMarqueeAdditiveModifier", () => {
  it("treats shift as additive on both platforms", () => {
    expect(
      isMarqueeAdditiveModifier(
        { metaKey: false, ctrlKey: false, shiftKey: true },
        "mac",
      ),
    ).toBe(true);
  });

  it("macOS ignores ctrlKey for marquee additive", () => {
    expect(
      isMarqueeAdditiveModifier(
        { metaKey: false, ctrlKey: true, shiftKey: false },
        "mac",
      ),
    ).toBe(false);
  });
});

describe("isMarqueeToggleModifier", () => {
  it("is false when shift is held", () => {
    expect(
      isMarqueeToggleModifier(
        { metaKey: true, ctrlKey: false, shiftKey: true },
        "mac",
      ),
    ).toBe(false);
  });
});
