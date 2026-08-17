import { describe, expect, it } from "vitest";
import { resolveMasonryCenterRange } from "../../src/renderer/masonry-selection-range";

describe("resolveMasonryCenterRange", () => {
  it("selects card centers inside the anchor-target rectangle", () => {
    expect(
      resolveMasonryCenterRange({
        anchorId: "a",
        targetId: "d",
        browseOrder: ["a", "b", "c", "d", "e"],
        items: [
          { id: "a", x: 10, y: 10 },
          { id: "b", x: 110, y: 10 },
          { id: "c", x: 210, y: 10 },
          { id: "d", x: 210, y: 210 },
          { id: "e", x: 310, y: 210 },
        ],
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("returns an empty range when either card is unavailable", () => {
    expect(
      resolveMasonryCenterRange({
        anchorId: "missing",
        targetId: "b",
        browseOrder: ["a", "b"],
        items: [{ id: "a", x: 0, y: 0 }],
      }),
    ).toEqual([]);
  });
});
