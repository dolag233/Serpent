import { describe, expect, it } from "vitest";

import { LibraryService } from "../../src/worker/library-service";

describe("LibraryService.toSummaryMediaType (Serpent-671)", () => {
  it("preserves audio and text instead of collapsing to other", () => {
    expect(LibraryService.toSummaryMediaType("audio")).toBe("audio");
    expect(LibraryService.toSummaryMediaType("text")).toBe("text");
    expect(LibraryService.toSummaryMediaType("image")).toBe("image");
    expect(LibraryService.toSummaryMediaType("video")).toBe("video");
    expect(LibraryService.toSummaryMediaType("other")).toBe("other");
  });

  it("detects mp3 as audio for summary mapping", () => {
    expect(
      LibraryService.toSummaryMediaType(
        LibraryService.detectMediaType("track.mp3"),
      ),
    ).toBe("audio");
  });
});
