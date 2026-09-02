// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { FilterTagPicker } from "../../src/renderer/FilterTagPicker";
import { LocaleProvider } from "../../src/renderer/i18n";

const tags = [
  { tagId: "warm", name: "Warm", assetCount: 10 },
  { tagId: "wood", name: "Wood", assetCount: 8 },
  { tagId: "metal", name: "Metal", assetCount: 6 },
  { tagId: "glass", name: "Glass", assetCount: 4 },
  { tagId: "sci-fi", name: "SciFi", assetCount: 2 },
  { tagId: "unused", name: "Unused", assetCount: 0 },
];

describe("FilterTagPicker sorting", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("sorts visible suggestions by usage or name and toggles direction", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "en" },
          createElement(FilterTagPicker, {
            onChange: () => undefined,
            selectedNames: [],
            tags,
          }),
        ),
      );
    });

    const optionNames = () =>
      [...container!.querySelectorAll<HTMLButtonElement>(".filter-tag-options button")]
        .map((button) => button.querySelector("span")?.textContent);
    const sortButtons = () =>
      [...container!.querySelectorAll<HTMLButtonElement>(".filter-tag-sort button")];

    expect(optionNames()).toEqual(["Warm", "Wood", "Metal", "Glass", "SciFi", "Unused"]);
    expect(sortButtons()[0]?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      sortButtons()[1]?.click();
    });
    expect(optionNames()).toEqual(["Glass", "Metal", "SciFi", "Unused", "Warm", "Wood"]);

    await act(async () => {
      sortButtons()[1]?.click();
    });
    expect(optionNames()).toEqual(["Wood", "Warm", "Unused", "SciFi", "Metal", "Glass"]);
  });
});
