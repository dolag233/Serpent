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

  it("opens the open-library chooser from the library-name menu", async () => {
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
    const openLibrary = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => {
      const text = button.textContent ?? "";
      return text.includes("打开资源库") || text === "Open library…";
    });
    expect(openLibrary).toBeDefined();

    await act(async () => {
      openLibrary?.click();
    });
    expect(onOpenLibrary).toHaveBeenCalledTimes(1);
  });

  it("does not keep separate open-external or import-external menu rows", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(LibrarySwitcher, {
            libraryName: "Current",
            libraryOpen: true,
            onCreateLibrary: vi.fn(),
            onOpenLibrary: vi.fn(),
            onImportLibrary: vi.fn(),
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const labels = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].map((button) => button.textContent ?? "");
    expect(labels.some((text) => text.includes("打开外部资源库"))).toBe(false);
    expect(labels.some((text) => text.includes("导入外部资源库"))).toBe(false);
    expect(labels.some((text) => text.includes("Eagle"))).toBe(false);
    expect(labels.some((text) => text.includes("Billfish"))).toBe(false);
  });

  it("keeps the requested library action order and import hint", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(LibrarySwitcher, {
            libraryName: "Current",
            libraryOpen: true,
            onCreateLibrary: vi.fn(),
            onOpenLibrary: vi.fn(),
            onImportLibrary: vi.fn(),
            onExportLibrary: vi.fn(),
            onRemoveLibrary: vi.fn(),
            onDeleteLibraryFromDisk: vi.fn(),
            onOpenLibrarySettings: vi.fn(),
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });

    const labels = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".library-switcher-menu button.library-switcher-item:not(.library-switcher-recent-open)",
      ),
    ].map((button) => button.textContent?.trim());
    expect(labels).toEqual([
      "新建资源库…",
      "打开资源库…",
      "关闭资源库",
      "导入资源库",
      "导出资源库",
      "移除资源库",
      "从硬盘删除资源库…",
      "资源库设置",
    ]);

    expect(labels.some((text) => text.includes("打开同步资源库"))).toBe(false);
    expect(labels.some((text) => text.includes("重命名资源库"))).toBe(false);

    const importLibrary = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.trim() === "导入资源库");
    expect(importLibrary?.dataset.hoverTip).toContain("添加、合并");

    const deleteLibrary = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.includes("从硬盘删除资源库"));
    expect(deleteLibrary?.classList.contains("is-danger")).toBe(true);
  });

  it("does not keep a rename-library menu row", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(LibrarySwitcher, {
            libraryName: "Current",
            libraryOpen: true,
            onCreateLibrary: vi.fn(),
            onOpenLibrary: vi.fn(),
            onOpenLibrarySettings: vi.fn(),
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const labels = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].map((button) => button.textContent ?? "");
    expect(labels.some((text) => text.includes("重命名资源库"))).toBe(false);
    expect(labels.some((text) => text.includes("打开同步资源库"))).toBe(false);
  });

  it("opens the export-library dialog from the library-name menu (Serpent-27e1fc)", async () => {
    const onExportLibrary = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(LibrarySwitcher, {
            libraryName: "Current",
            libraryOpen: true,
            onCreateLibrary: vi.fn(),
            onOpenLibrary: vi.fn(),
            onImportLibrary: vi.fn(),
            onExportLibrary,
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const exportLibrary = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.trim() === "导出资源库");
    expect(exportLibrary).toBeDefined();

    await act(async () => {
      exportLibrary?.click();
    });
    expect(onExportLibrary).toHaveBeenCalledTimes(1);
  });
});
