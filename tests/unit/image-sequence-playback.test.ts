import { describe, expect, it } from "vitest";

import { advanceImageSequenceFrame } from "../../src/renderer/image-sequence-playback";

describe("advanceImageSequenceFrame", () => {
  it("wraps playback at the end of the sequence", () => {
    expect(advanceImageSequenceFrame(2, 3, true)).toBe(0);
  });

  it("ignores a queued tick after playback has been paused", () => {
    expect(advanceImageSequenceFrame(1, 3, false)).toBe(1);
  });
});
