// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { FontSizeProvider, useFontSize } from "../../src/renderer/FontSizeProvider";

function Probe() {
  const { preferences, setPreference } = useFontSize();
  return createElement(
    "button",
    { onClick: () => setPreference("comfortable") },
    preferences.preference,
  );
}

describe("FontSizeProvider", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    document.documentElement.removeAttribute("data-font-size");
    document.documentElement.style.removeProperty("--ui-font-scale");
  });

  it("updates the root scale and persists when a tier is selected", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          FontSizeProvider,
          { children: createElement(Probe), storage },
        ),
      );
    });
    expect(container.textContent).toBe("default");

    await act(async () => {
      container?.querySelector("button")?.click();
    });
    expect(container.textContent).toBe("comfortable");
    expect(document.documentElement.dataset.fontSize).toBe("comfortable");
    expect(values.size).toBe(1);
  });
});
