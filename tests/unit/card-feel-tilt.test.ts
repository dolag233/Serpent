import { describe, expect, it } from "vitest";

import {
  CARD_FEEL_LIGHT_Z,
  cardFeelSpecularHighlight,
  cardFeelTiltFromPointer,
} from "../../src/renderer/card-feel-tilt";

describe("cardFeelTiltFromPointer", () => {
  const rect = { left: 0, top: 0, width: 200, height: 100 };

  it("tips the near edge toward the viewer under the pointer", () => {
    const center = cardFeelTiltFromPointer(rect, 100, 50);
    expect(center.rotateX).toBeCloseTo(0, 5);
    expect(center.rotateY).toBeCloseTo(0, 5);

    const left = cardFeelTiltFromPointer(rect, 0, 50);
    expect(left.rotateY).toBeGreaterThan(0);

    const right = cardFeelTiltFromPointer(rect, 200, 50);
    expect(right.rotateY).toBeLessThan(0);

    const top = cardFeelTiltFromPointer(rect, 100, 0);
    expect(top.rotateX).toBeLessThan(0);
  });

  it("places the specular near the light footprint, not a fixed center swirl", () => {
    const left = cardFeelTiltFromPointer(rect, 20, 50);
    expect(left.glareX).toBeLessThan(45);
    const right = cardFeelTiltFromPointer(rect, 180, 50);
    expect(right.glareX).toBeGreaterThan(55);
  });
});

describe("cardFeelSpecularHighlight", () => {
  it("moves the hotspot toward the raised face as light Z decreases", () => {
    // Tip left edge toward viewer (positive rotateY) with light at center.
    const far = cardFeelSpecularHighlight(0.5, 0.5, 0, 6, 2.0);
    const near = cardFeelSpecularHighlight(0.5, 0.5, 0, 6, 0.4);
    // Smaller Z → stronger slide along normal XY (toward raised / +X here).
    expect(near.glareX).toBeGreaterThan(far.glareX);
  });

  it("defaults to a stable light height", () => {
    expect(CARD_FEEL_LIGHT_Z).toBeGreaterThan(0.5);
  });
});
