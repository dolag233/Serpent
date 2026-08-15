// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibrarySwitcher } from "../../src/renderer/LibrarySwitcher";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("LibrarySwitcher external library action", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("opens the external-library picker from the library-name menu", async () => {
    const onOpenLibrary = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(LibrarySwitcher, {
            libraryName: "Current",
            libraryOpen: true,
            onCreateLibrary: vi.fn(),
            onOpenLibrary,
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const openExternal = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => {
      const text = button.textContent ?? "";
      return text.includes("打开外部资源库") || text.includes("external library");
    });
    expect(openExternal).toBeDefined();

    await act(async () => {
      openExternal?.click();
    });
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });
});
