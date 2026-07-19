import { describe, expect, it } from "vitest";

import { isGifDisplayName } from "../../src/renderer/gif-player-controls";

describe("isGifDisplayName", () => {
  it("detects gif extensions case-insensitively", () => {
    expect(isGifDisplayName("loop.GIF")).toBe(true);
    expect(isGifDisplayName("still.png")).toBe(false);
  });
});
