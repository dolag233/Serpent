// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImportLibraryChooserDialog, OpenLibraryChooserDialog } from "../../src/renderer/ImportLibraryChooserDialog";
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
    const onOpenBillfish = vi.fn();
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
            onOpenBillfish,
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
    expect(billfish?.disabled).toBe(false);

    await act(async () => {
      eagle?.click();
    });
    expect(onOpenEagle).toHaveBeenCalledTimes(1);
    expect(onOpenBillfish).not.toHaveBeenCalled();
    expect(onImportFolder).not.toHaveBeenCalled();
  });

  it("uses import-external copy and the merge Eagle action when a library is open", async () => {
    const onImportEagle = vi.fn();
    const onImportBillfish = vi.fn();
    const onOpenEagle = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(ImportLibraryChooserDialog, {
            open: true,
            externalKind: "import",
            onImportFolder: vi.fn(),
            onImportZip: vi.fn(),
            onOpenEagle,
            onImportEagle,
            onImportBillfish,
            onCancel: vi.fn(),
          }),
        ),
      );
    });

    const findButton = (pattern: RegExp) =>
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => pattern.test(button.textContent ?? ""),
      );

    const disclosure = findButton(/导入外部资源库/);
    expect(disclosure).toBeDefined();
    expect(findButton(/打开外部资源库/)).toBeUndefined();

    await act(async () => {
      disclosure?.click();
    });

    const eagle = findButton(/导入 Eagle 资源库/);
    expect(eagle).toBeDefined();
    expect(eagle?.className).toContain("secondary-button");
    expect(eagle?.parentElement?.className).toContain("dialog-actions");
    expect(findButton(/导入 Billfish/)?.disabled).toBe(false);

    await act(async () => {
      eagle?.click();
    });
    expect(onImportEagle).toHaveBeenCalledTimes(1);
    expect(onOpenEagle).not.toHaveBeenCalled();
  });
});

describe("OpenLibraryChooserDialog", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("keeps Eagle and Billfish collapsed until 打开外部资源库 is expanded", async () => {
    const onOpenSerpent = vi.fn();
    const onOpenEagle = vi.fn();
    const onOpenBillfish = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(OpenLibraryChooserDialog, {
            open: true,
            onOpenSerpent,
            onOpenSyncLibrary: vi.fn(),
            onOpenEagle,
            onOpenBillfish,
            onCancel: vi.fn(),
          }),
        ),
      );
    });

    const findButton = (pattern: RegExp) =>
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => pattern.test(button.textContent ?? ""),
      );

    expect(findButton(/打开 Eagle 资源库/)).toBeUndefined();
    const serpent = findButton(/打开 Serpent 资源库/);
    expect(serpent).toBeDefined();

    const disclosure = findButton(/打开外部资源库/);
    expect(disclosure).toBeDefined();

    await act(async () => {
      disclosure?.click();
    });

    const eagle = findButton(/打开 Eagle 资源库/);
    expect(eagle).toBeDefined();
    expect(eagle?.className).toContain("secondary-button");
    const billfish = findButton(/打开 Billfish/);
    expect(billfish?.disabled).toBe(false);

    await act(async () => {
      billfish?.click();
    });
    expect(onOpenBillfish).toHaveBeenCalledTimes(1);
    expect(onOpenEagle).not.toHaveBeenCalled();

    await act(async () => {
      serpent?.click();
    });
    expect(onOpenSerpent).toHaveBeenCalledTimes(1);
    expect(onOpenEagle).not.toHaveBeenCalled();
    expect(onOpenBillfish).toHaveBeenCalledTimes(1);
  });

  it("offers 打开同步资源库 as a top-level open action", async () => {
    const onOpenSerpent = vi.fn();
    const onOpenSyncLibrary = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(OpenLibraryChooserDialog, {
            open: true,
            onOpenSerpent,
            onOpenSyncLibrary,
            onOpenEagle: vi.fn(),
            onOpenBillfish: vi.fn(),
            onCancel: vi.fn(),
          }),
        ),
      );
    });

    const findButton = (pattern: RegExp) =>
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => pattern.test(button.textContent ?? ""),
      );

    const sync = findButton(/打开同步资源库/);
    expect(sync).toBeDefined();
    expect(sync?.className).toContain("secondary-button");
    expect(sync?.dataset.hoverTip).toContain("WebDAV");
    expect(findButton(/打开 Eagle 资源库/)).toBeUndefined();

    await act(async () => {
      sync?.click();
    });
    expect(onOpenSyncLibrary).toHaveBeenCalledTimes(1);
    expect(onOpenSerpent).not.toHaveBeenCalled();
  });
});
