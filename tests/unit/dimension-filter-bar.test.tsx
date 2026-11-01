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
      includeAiTagFilter: true,
      ratingFilter: "",
      excludeRatingFilter: false,
      includeAiRatingFilter: true,
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
    colorSimilarity: 30,
    setColorSimilarity: vi.fn(),
    colorFilterPrefs: {
      version: 1,
      customColors: [],
      similarity: 30,
    },
    onColorFilterPrefsChange: vi.fn(),
    formatFilter: "",
    setFormatFilter: vi.fn(),
    excludeFormatFilter: false,
    setExcludeFormatFilter: vi.fn(),
    tagFilter: "",
    setTagFilter: vi.fn(),
    excludeTagFilter: false,
    setExcludeTagFilter: vi.fn(),
    excludedTagFilter: "",
    setExcludedTagFilter: vi.fn(),
    includeAiTag: true,
    setIncludeAiTag: vi.fn(),
    onTagNamesChange: vi.fn(),
    ratingFilter: "",
    setRatingFilter: vi.fn(),
    excludeRatingFilter: false,
    setExcludeRatingFilter: vi.fn(),
    includeAiRating: true,
    setIncludeAiRating: vi.fn(),
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

  /**
   * 用户 2026-09-13:「这几个过滤的按钮的 icon，除了标签和评分，都完全不符合他的内容」
   * — 颜色 借用了 `activity`(心电折线)、形状 借用了 `grid`(四宫格)、仅喜欢 与 评分 共用
   * 同一个星形。这条断言把「每个过滤按钮都有图标，且彼此图形不同」钉住：既防止按钮丢失
   * 图标，也防止再次出现两个语义不同的过滤共用一个图形。
   */
  it("gives every dimension filter its own distinct icon", async () => {
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

    const labelled = ["Color", "Tags", "Shape", "Rating", "Favorites only"];
    const glyphs = labelled.map((label) => {
      const button = [...container!.querySelectorAll<HTMLButtonElement>("button")]
        .find((candidate) => candidate.textContent?.includes(label));
      expect(button, `missing ${label} filter button`).toBeDefined();
      const icon = button!.querySelector("svg.icon");
      expect(icon, `${label} filter has no icon`).not.toBeNull();
      const markup = icon!.innerHTML;
      expect(markup.length, `${label} filter icon is empty`).toBeGreaterThan(0);
      return markup;
    });

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("keeps AI values included by default in rating and tag filters", async () => {
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

    const ratingButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Rating"));
    expect(ratingButton).toBeDefined();
    await act(async () => ratingButton?.focus());
    const ratingPopover = document.body.querySelector(
      '[data-dimension-filter-popover][data-dimension="rating"]',
    );
    expect(ratingPopover).not.toBeNull();
    expect(ratingPopover?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]?.checked)
      .toBe(true);

    await act(async () => root?.unmount());
    root = undefined;
    document.body.querySelector("[data-dimension-filter-popover]")?.remove();
  });

  it("does not highlight More when a bundled filter is on", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const current = props();
    current.favoriteFilter = "yes";
    current.excludeAvailabilityFilter = true;
    current.availabilityFilter = "missing";

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "en" },
          createElement(DimensionFilterBar, current),
        ),
      );
    });

    const more = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("More"));
    expect(more?.classList.contains("is-active")).toBe(false);
    expect(more?.classList.contains("is-excluding")).toBe(false);
    expect(more?.getAttribute("aria-pressed")).toBeNull();
  });
});
