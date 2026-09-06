// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DimensionFilterBar,
  type DimensionFilterBarProps,
} from "../../src/renderer/DimensionFilterBar";
import { LocaleProvider } from "../../src/renderer/i18n";

const range = () => ({ min: "", max: "", exclude: false });

function props(): DimensionFilterBarProps {
  return {
    tags: [],
    snapshot: {
      colorFilter: "",
      excludeColorFilter: false,
      formatFilter: "",
      excludeFormatFilter: false,
      tagFilter: "",
      excludeTagFilter: false,
      ratingFilter: "",
      excludeRatingFilter: false,
      favoriteFilter: "any",
      sourceUrlFilter: "any",
      availabilityFilter: "any",
      excludeAvailabilityFilter: false,
      widthRange: range(),
      heightRange: range(),
      aspectRatioRange: range(),
      longEdgeRange: range(),
      durationRange: range(),
    },
    colorFilter: "",
    setColorFilter: vi.fn(),
    excludeColorFilter: false,
    setExcludeColorFilter: vi.fn(),
    formatFilter: "",
    setFormatFilter: vi.fn(),
    excludeFormatFilter: false,
    setExcludeFormatFilter: vi.fn(),
    tagFilter: "",
    setTagFilter: vi.fn(),
    excludeTagFilter: false,
    setExcludeTagFilter: vi.fn(),
    onTagNamesChange: vi.fn(),
    ratingFilter: "",
    setRatingFilter: vi.fn(),
    excludeRatingFilter: false,
    setExcludeRatingFilter: vi.fn(),
    favoriteFilter: "any",
    setFavoriteFilter: vi.fn(),
    sourceUrlFilter: "any",
    setSourceUrlFilter: vi.fn(),
    availabilityFilter: "any",
    setAvailabilityFilter: vi.fn(),
    excludeAvailabilityFilter: false,
    setExcludeAvailabilityFilter: vi.fn(),
    aspectRatioRange: range(),
    setAspectRatioRange: vi.fn(),
    aspectRatioRanges: [],
    setAspectRatioRanges: vi.fn(),
    longEdgeRange: range(),
    setLongEdgeRange: vi.fn(),
    widthRange: range(),
    setWidthRange: vi.fn(),
    heightRange: range(),
    setHeightRange: vi.fn(),
    durationRange: range(),
    setDurationRange: vi.fn(),
    sortField: "name",
    setSortField: vi.fn(),
    sortOrder: "asc",
    setSortOrder: vi.fn(),
    onClearFilter: vi.fn(),
  };
}

describe("DimensionFilterBar hover opening", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    vi.useRealTimers();
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    document.body.querySelector("[data-dimension-filter-popover]")?.remove();
  });

  it("waits 500ms for pointer hover but opens immediately on focus", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "en" },
          createElement(DimensionFilterBar, props()),
        ),
      );
    });

    const colorButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Color"));
    expect(colorButton).toBeDefined();

    await act(async () => {
      colorButton?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).not.toBeNull();

    await act(async () => {
      root?.unmount();
      root = undefined;
      container?.remove();
      container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      root.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "en" },
          createElement(DimensionFilterBar, props()),
        ),
      );
    });
    const freshColorButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Color"));
    await act(async () => {
      freshColorButton?.focus();
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).not.toBeNull();
  });

  it("does not reopen after leaving while a duplicate hover timer is pending", async () => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "en" },
          createElement(DimensionFilterBar, props()),
        ),
      );
    });

    const colorButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Color"));
    expect(colorButton).toBeDefined();
    const outside = document.createElement("div");

    await act(async () => {
      colorButton?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      vi.advanceTimersByTime(500);
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).not.toBeNull();

    // A second pointerover can arrive from a child/nearby pointer transition
    // while the same dimension is already open. Leaving must cancel that
    // delayed open before the close timer runs.
    await act(async () => {
      colorButton?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      colorButton?.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: outside }),
      );
      vi.advanceTimersByTime(150);
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(document.body.querySelector("[data-dimension-filter-popover]")).toBeNull();
  });
});
