// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportLibraryChooserDialog } from "../../src/renderer/ImportLibraryChooserDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("ImportLibraryChooserDialog external library open", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("keeps Eagle and Billfish collapsed until 打开外部资源库 is expanded", async () => {
    const onOpenEagle = vi.fn();
    const onImportFolder = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(ImportLibraryChooserDialog, {
            open: true,
            onImportFolder,
            onImportZip: vi.fn(),
            onOpenEagle,
            onCancel: vi.fn(),
          }),
        ),
      );
    });

    const findButton = (pattern: RegExp) =>
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => pattern.test(button.textContent ?? ""),
      );

    expect(findButton(/打开 Eagle 资源库|Open Eagle library/)).toBeUndefined();
    expect(
      findButton(/打开 Billfish 资源库|Open Billfish library/),
    ).toBeUndefined();

    const disclosure = findButton(/打开外部资源库|Open external library/);
    expect(disclosure).toBeDefined();
    expect(disclosure?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => {
      disclosure?.click();
    });

    expect(disclosure?.getAttribute("aria-expanded")).toBe("true");
    const eagle = findButton(/打开 Eagle 资源库|Open Eagle library/);
    const billfish = findButton(/打开 Billfish 资源库|Open Billfish library/);
    expect(eagle).toBeDefined();
    expect(eagle?.disabled).toBe(false);
    expect(eagle?.className).toContain("secondary-button");
    expect(eagle?.parentElement?.className).toContain("dialog-actions");
    expect(billfish?.disabled).toBe(true);

    await act(async () => {
      eagle?.click();
    });
    expect(onOpenEagle).toHaveBeenCalledTimes(1);
    expect(onImportFolder).not.toHaveBeenCalled();
  });
});
