// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../src/renderer/i18n";
import { MainMenu } from "../../src/renderer/MainMenu";
import type { MainMenuSection } from "../../src/renderer/main-menu-items";

describe("MainMenu nested submenu keyboard navigation", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  it("opens the external-library submenu and returns to its parent with ArrowLeft", async () => {
    const selectEagle = vi.fn();
    const sections: MainMenuSection[] = [
      {
        id: "library",
        label: "Library",
        icon: "folder",
        items: [
          {
            id: "library.import-external",
            label: "Import external library",
            onSelect: vi.fn(),
            submenu: [
              {
                id: "library.import-eagle",
                label: "Import Eagle library",
                onSelect: selectEagle,
              },
              {
                id: "library.import-billfish",
                label: "Import Billfish library",
                onSelect: vi.fn(),
              },
            ],
          },
        ],
      },
    ];

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(MainMenu, { sections }),
        ),
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      ".main-menu-trigger",
    );
    await act(async () => {
      trigger?.click();
    });
    const librarySection = container.querySelector<HTMLButtonElement>(
      '[data-main-menu-section-id="library"]',
    );
    await act(async () => {
      librarySection?.click();
    });

    const parent = container.querySelector<HTMLButtonElement>(
      '[data-main-menu-item-id="library.import-external"]',
    );
    expect(parent).not.toBeNull();
    await act(async () => {
      parent?.click();
    });

    const child = container.querySelector<HTMLButtonElement>(
      '[data-main-menu-item-id="library.import-eagle"]',
    );
    const secondChild = container.querySelector<HTMLButtonElement>(
      '[data-main-menu-item-id="library.import-billfish"]',
    );
    expect(child).not.toBeNull();
    expect(secondChild).not.toBeNull();
    await act(async () => {
      parent?.focus();
      parent?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(document.activeElement).toBe(child);

    await act(async () => {
      child?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowLeft" }));
    });
    expect(document.activeElement).toBe(parent);

    await act(async () => {
      child?.focus();
      child?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
    });
    expect(document.activeElement).toBe(secondChild);
    await act(async () => {
      secondChild?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowUp" }));
    });
    expect(document.activeElement).toBe(child);
    await act(async () => {
      child?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowRight" }));
    });
    expect(document.activeElement).toBe(child);

    expect(selectEagle).not.toHaveBeenCalled();
  });
});
