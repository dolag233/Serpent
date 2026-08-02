import { describe, expect, it } from "vitest";

import { isViewerFitShortcut } from "../../src/renderer/viewer-fit-shortcut";

describe("isViewerFitShortcut", () => {
  it("accepts the physical numpad decimal key and Windows legacy values", () => {
    expect(isViewerFitShortcut({ code: "NumpadDecimal", key: "." })).toBe(true);
    expect(isViewerFitShortcut({ code: "Decimal", key: "Decimal" })).toBe(true);
    expect(isViewerFitShortcut({ key: "NumpadDecimal" })).toBe(true);
    expect(isViewerFitShortcut({ key: ".", location: 3 })).toBe(true);
  });

  it("does not treat the regular period key as fit", () => {
    expect(isViewerFitShortcut({ key: ".", location: 0 })).toBe(false);
  });
});
