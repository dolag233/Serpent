import { describe, expect, it } from "vitest";

import { cardFeelTiltFromPointer } from "../../src/renderer/card-feel-tilt";

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
});
