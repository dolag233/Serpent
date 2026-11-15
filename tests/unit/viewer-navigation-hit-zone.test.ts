import { describe, expect, it } from "vitest";

import { viewerNavigationSide } from "../../src/renderer/viewer-navigation-hit-zone";

describe("viewer navigation hit zone", () => {
  const bounds = { left: 18, top: 23, width: 788, height: 852 };

  it("uses the narrow middle edge strips on both sides", () => {
    expect(viewerNavigationSide(bounds, 40, 449)).toBe("prev");
    expect(viewerNavigationSide(bounds, 775, 449)).toBe("next");
    expect(viewerNavigationSide(bounds, 120, 449)).toBeNull();
    expect(viewerNavigationSide(bounds, 700, 449)).toBeNull();
  });

  it("leaves the top and bottom of the image available for other interactions", () => {
    expect(viewerNavigationSide(bounds, 775, 205)).toBeNull();
    expect(viewerNavigationSide(bounds, 775, 700)).toBeNull();
    expect(viewerNavigationSide(bounds, 775, 838)).toBeNull();
  });

  it("keeps a usable edge width in narrow and wide viewers", () => {
    expect(viewerNavigationSide({ ...bounds, width: 400 }, 73, 449)).toBe("prev");
    expect(viewerNavigationSide({ ...bounds, width: 1600 }, 98, 449)).toBe("prev");
    expect(viewerNavigationSide({ ...bounds, width: 1600 }, 99, 449)).toBeNull();
  });
});
