import { describe, expect, it } from "vitest";

import {
  applyViewerDisplayTransformAction,
  IDENTITY_VIEWER_DISPLAY_TRANSFORM,
} from "../../src/renderer/viewer-display-transform";

describe("viewer display transform actions", () => {
  it("rotates without changing mirror state", () => {
    expect(
      applyViewerDisplayTransformAction(
        { flipHorizontal: true, flipVertical: false, quarterTurns: 3 },
        "rotate-clockwise",
      ),
    ).toEqual({ flipHorizontal: true, flipVertical: false, quarterTurns: 4 });
  });

  it("toggles each mirror axis independently", () => {
    const horizontal = applyViewerDisplayTransformAction(
      IDENTITY_VIEWER_DISPLAY_TRANSFORM,
      "flip-horizontal",
    );
    expect(horizontal).toEqual({
      flipHorizontal: true,
      flipVertical: false,
      quarterTurns: 0,
    });
    expect(
      applyViewerDisplayTransformAction(horizontal, "flip-vertical"),
    ).toEqual({ flipHorizontal: true, flipVertical: true, quarterTurns: 0 });
  });

  it("resets all transforms", () => {
    expect(
      applyViewerDisplayTransformAction(
        { flipHorizontal: true, flipVertical: true, quarterTurns: 7 },
        "reset",
      ),
    ).toEqual(IDENTITY_VIEWER_DISPLAY_TRANSFORM);
  });
});
