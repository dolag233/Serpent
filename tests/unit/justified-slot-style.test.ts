import { describe, expect, it } from "vitest";

import { justifiedSlotStyle } from "../../src/renderer/justified-asset-rows";

function previewHeight(style: ReturnType<typeof justifiedSlotStyle>) {
  return (style as Record<string, unknown>)["--justified-preview-height"];
}

describe("justifiedSlotStyle (Serpent-5p45)", () => {
  it("locks preview height to placement height via CSS variable", () => {
    const style = justifiedSlotStyle({
      id: "portrait",
      width: 120,
      height: 240,
    });
    expect(style.width).toBe(120);
    expect(previewHeight(style)).toBe("240px");
  });

  it("does not depend on caption band height", () => {
    // Caption may render taller than any reserved band; slot style must
    // still expose only the layout algorithm's media height.
    const tallCaptionWouldHaveBeen = 80;
    const placementHeight = 180;
    const style = justifiedSlotStyle({
      id: "a",
      width: Math.round(placementHeight * (9 / 16)),
      height: placementHeight,
    });
    expect(previewHeight(style)).toBe(`${placementHeight}px`);
    expect(previewHeight(style)).not.toBe(
      `${placementHeight + tallCaptionWouldHaveBeen}px`,
    );
  });

  it("clamps non-positive placement height to 1px", () => {
    expect(
      previewHeight(justifiedSlotStyle({ id: "z", width: 40, height: 0 })),
    ).toBe("1px");
  });
});
