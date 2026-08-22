import { describe, expect, it } from "vitest";

import { shouldShowApplyToRest } from "../../src/renderer/image-sequence-import-dialog";

describe("image sequence import dialog", () => {
  it("hides apply-to-rest for a single sequence", () => {
    expect(shouldShowApplyToRest(0, 1)).toBe(false);
  });

  it("shows apply-to-rest only when a later sequence exists", () => {
    expect(shouldShowApplyToRest(0, 2)).toBe(true);
    expect(shouldShowApplyToRest(1, 2)).toBe(false);
  });

  it("rejects indexes outside the sequence list", () => {
    expect(shouldShowApplyToRest(-1, 2)).toBe(false);
    expect(shouldShowApplyToRest(2, 2)).toBe(false);
  });
});
