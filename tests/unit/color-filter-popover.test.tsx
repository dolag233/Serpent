// @vitest-environment happy-dom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ColorFilterPopover } from "../../src/renderer/ColorFilterPopover";
import {
  DEFAULT_COLOR_FILTER_PREFERENCES,
  type ColorFilterPreferences,
} from "../../src/renderer/color-filter-preferences";
import { LocaleProvider } from "../../src/renderer/i18n";
import { COLOR_PRESETS } from "../../src/shared/color-filter-presets";

describe("ColorFilterPopover", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = null;
    root = null;
  });

  function renderPopover(options: {
    initialFilter?: string;
    onColorFilter?: ReturnType<typeof vi.fn<(value: string) => void>>;
    onColorFilterPrefsChange?: ReturnType<
      typeof vi.fn<(prefs: ColorFilterPreferences) => void>
    >;
  } = {}) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onColorFilter = options.onColorFilter ?? vi.fn<(value: string) => void>();
    const onColorFilterPrefsChange =
      options.onColorFilterPrefsChange ??
      vi.fn<(prefs: ColorFilterPreferences) => void>();

    function Harness() {
      const [colorFilter, setColorFilter] = useState(options.initialFilter ?? "");
      const [prefs, setPrefs] = useState<ColorFilterPreferences>(
        DEFAULT_COLOR_FILTER_PREFERENCES,
      );
      return createElement(ColorFilterPopover, {
        colorFilter,
        colorFilterPrefs: prefs,
        colorSimilarity: 30,
        disabled: false,
        excludeColorFilter: false,
        onColorFilterPrefsChange: (next) => {
          setPrefs(next);
          onColorFilterPrefsChange(next);
        },
        setColorFilter: (value) => {
          setColorFilter(value);
          onColorFilter(value);
        },
        setColorSimilarity: vi.fn(),
        setExcludeColorFilter: vi.fn(),
      });
    }

    act(() => {
      root?.render(
        createElement(LocaleProvider, { children: null, initialPreference: "en" }, createElement(Harness)),
      );
    });
    return { onColorFilter, onColorFilterPrefsChange };
  }

  it("keeps the ten standard colors on a dedicated first row", () => {
    renderPopover();
    const presets = container!.querySelector("[data-color-presets]");
    expect(presets).not.toBeNull();
    expect(presets!.querySelectorAll("[data-color]")).toHaveLength(COLOR_PRESETS.length);
    expect(container!.querySelector("[data-color-custom] [data-color-add]")).not.toBeNull();
  });

  it("places exclude after the compact similarity row", () => {
    renderPopover();
    const similarity = container!.querySelector("[data-color-similarity]");
    const exclude = [...container!.querySelectorAll("label")].find((label) =>
      label.textContent?.includes("Exclude"),
    );
    expect(similarity).not.toBeNull();
    expect(exclude).toBeDefined();
    expect(
      Boolean(
        similarity!.compareDocumentPosition(exclude!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("opens the picker immediately, previews the draft on the disc, and puts confirm on the right", () => {
    const { onColorFilter, onColorFilterPrefsChange } = renderPopover();
    act(() => {
      container!.querySelector<HTMLButtonElement>("[data-color-add]")!.click();
    });
    const panel = container!.querySelector("[data-color-add-draft]");
    expect(panel).not.toBeNull();
    expect(panel!.querySelector("[data-color-picker-sv]")).not.toBeNull();
    expect(container!.querySelector("input[type='color']")).toBeNull();
    expect(onColorFilter).toHaveBeenCalledWith("#888888");
    expect(container!.querySelector("[data-color-draft] [data-color='#888888']")).not.toBeNull();
    const actions = [...panel!.querySelectorAll(".dimension-color-picker-actions button")];
    expect(actions.map((button) => button.textContent)).toEqual(["Cancel", "Confirm"]);
    expect(onColorFilterPrefsChange).not.toHaveBeenCalled();
  });

  it("restores the previous filter when the picker is cancelled", () => {
    const { onColorFilter, onColorFilterPrefsChange } = renderPopover({
      initialFilter: "red",
    });
    act(() => {
      container!.querySelector<HTMLButtonElement>("[data-color-add]")!.click();
    });
    expect(onColorFilter).toHaveBeenCalledWith("#888888");
    const cancel = [...container!.querySelectorAll("[data-color-add-draft] button")].find(
      (button) => button.textContent?.includes("Cancel"),
    );
    if (!(cancel instanceof HTMLElement)) {
      throw new Error("expected Cancel button");
    }
    act(() => {
      cancel.click();
    });
    expect(onColorFilter).toHaveBeenLastCalledWith("red");
    expect(onColorFilterPrefsChange).not.toHaveBeenCalled();
    expect(container!.querySelector("[data-color-add-draft]")).toBeNull();
    expect(container!.querySelector("[data-color-draft]")).toBeNull();
  });

  it("keeps the live color and stores one custom chip when confirmed", () => {
    const { onColorFilter, onColorFilterPrefsChange } = renderPopover();
    act(() => {
      container!.querySelector<HTMLButtonElement>("[data-color-add]")!.click();
    });
    const confirm = [...container!.querySelectorAll("[data-color-add-draft] button")].find(
      (button) => button.textContent?.includes("Confirm"),
    );
    if (!(confirm instanceof HTMLElement)) {
      throw new Error("expected Confirm button");
    }
    act(() => {
      confirm.click();
    });
    expect(onColorFilterPrefsChange).toHaveBeenCalledTimes(1);
    expect(onColorFilterPrefsChange.mock.calls[0]?.[0]?.customColors).toEqual([
      "#888888",
    ]);
    expect(onColorFilter).toHaveBeenCalledWith("#888888");
    expect(container!.querySelector("[data-color-add-draft]")).toBeNull();
    expect(container!.querySelector("[data-color-custom] [data-color='#888888']")).not.toBeNull();
  });
});
