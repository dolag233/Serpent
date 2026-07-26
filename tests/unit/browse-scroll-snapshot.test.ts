import { describe, expect, it } from "vitest";

import {
  shouldPreferTrackedBrowseSnapshot,
  shouldUpdateTrackedBrowseSnapshot,
} from "../../src/renderer/browse-scroll-snapshot";

describe("shouldPreferTrackedBrowseSnapshot", () => {
  it("prefers tracked when live scroll jumped to top", () => {
    expect(
      shouldPreferTrackedBrowseSnapshot(0, {
        scrollLeft: 0,
        scrollTop: 640,
        anchor: null,
      }),
    ).toBe(true);
  });

  it("does not reuse a deep snapshot when its anchor left the scope", () => {
    expect(
      shouldPreferTrackedBrowseSnapshot(
        0,
        { scrollLeft: 0, scrollTop: 640, anchor: null },
        false,
      ),
    ).toBe(false);
  });

  it("keeps live when both are near top", () => {
    expect(
      shouldPreferTrackedBrowseSnapshot(12, {
        scrollLeft: 0,
        scrollTop: 20,
        anchor: null,
      }),
    ).toBe(false);
  });
});

describe("shouldUpdateTrackedBrowseSnapshot", () => {
  it("tracks an intentional user scroll to the top", () => {
    expect(
      shouldUpdateTrackedBrowseSnapshot(
        { scrollLeft: 0, scrollTop: 640, anchor: null },
        { scrollLeft: 0, scrollTop: 0, anchor: null },
      ),
    ).toBe(true);
  });

  it("does not overwrite tracked snapshot on layout clamp to top", () => {
    expect(
      shouldUpdateTrackedBrowseSnapshot(
        { scrollLeft: 0, scrollTop: 640, anchor: null },
        { scrollLeft: 0, scrollTop: 0, anchor: null },
        true,
      ),
    ).toBe(false);
  });

  it("allows tracked updates while scrolling upward toward top", () => {
    expect(
      shouldUpdateTrackedBrowseSnapshot(
        { scrollLeft: 0, scrollTop: 640, anchor: null },
        { scrollLeft: 0, scrollTop: 120, anchor: null },
      ),
    ).toBe(true);
  });
});
