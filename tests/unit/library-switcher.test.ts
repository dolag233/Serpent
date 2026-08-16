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

  it("opens the local library picker directly from the library-name menu", async () => {
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

  it("exposes Eagle and Billfish open actions as a second-level menu", async () => {
    const onOpenEagleLibrary = vi.fn();
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
            onOpenLibrary: vi.fn(),
            onOpenEagleLibrary,
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const external = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => {
      const text = button.textContent ?? "";
      return text.includes("打开外部资源库") || text.includes("Open external library");
    });
    expect(external).toBeDefined();

    await act(async () => {
      external?.click();
    });
    expect(container.querySelector(".library-switcher-submenu")).toBeNull();

    await act(async () => {
      external?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
    });
    const billfish = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => {
      const text = button.textContent ?? "";
      return text.includes("Billfish");
    });
    expect(billfish).toBeDefined();
    expect(billfish?.disabled).toBe(true);

    const eagle = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => {
      const text = button.textContent ?? "";
      return text.includes("打开 Eagle") || text.includes("Open Eagle");
    });
    expect(eagle).toBeDefined();

    await act(async () => {
      eagle?.click();
    });
    expect(onOpenEagleLibrary).toHaveBeenCalledTimes(1);
  });

  it("exposes Eagle and Billfish import actions on hover", async () => {
    const onImportEagleLibrary = vi.fn();
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
            onImportEagleLibrary,
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });

    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const importExternal = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.includes("导入外部资源库"));
    expect(importExternal).toBeDefined();

    await act(async () => {
      importExternal?.click();
    });
    expect(container.querySelector(".library-switcher-submenu")).toBeNull();

    await act(async () => {
      importExternal?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }),
      );
    });
    const importEagle = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.includes("导入 Eagle"));
    const importBillfish = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.includes("导入 Billfish"));
    expect(importEagle).toBeDefined();
    expect(importBillfish).toBeDefined();
    expect(importBillfish?.disabled).toBe(true);

    await act(async () => {
      importEagle?.click();
    });
    expect(onImportEagleLibrary).toHaveBeenCalledTimes(1);
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
            onOpenEagleLibrary: vi.fn(),
            onImportEagleLibrary: vi.fn(),
            onImportLibrary: vi.fn(),
            onRemoveLibrary: vi.fn(),
            onDeleteLibraryFromDisk: vi.fn(),
            onRenameLibrary: vi.fn(),
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
        ".library-switcher-menu > button.library-switcher-item, " +
          ".library-switcher-menu > .library-switcher-submenu-wrap > button.library-switcher-item",
      ),
    ].map((button) =>
      button.textContent?.trim().replace(/›$/, ""),
    );
    expect(labels).toEqual([
      "新建资源库…",
      "打开资源库…",
      "打开外部资源库…",
      "导入资源库",
      "导入外部资源库",
      "移除资源库",
      "从硬盘删除资源库…",
      "重命名资源库",
      "资源库设置",
    ]);

    const importLibrary = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.trim() === "导入资源库");
    expect(importLibrary?.dataset.hoverTip).toContain("添加、合并");

    const deleteLibrary = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.includes("从硬盘删除资源库"));
    expect(deleteLibrary?.classList.contains("is-danger")).toBe(true);
  });

  it("opens the library settings rename entry", async () => {
    const onRenameLibrary = vi.fn();
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
            onRenameLibrary,
            onCloseLibrary: vi.fn(),
          }),
        ),
      );
    });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>(".library-switcher-trigger")?.click();
    });
    const rename = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]',
    )].find((button) => button.textContent?.trim() === "重命名资源库");
    expect(rename).toBeDefined();

    await act(async () => {
      rename?.click();
    });
    expect(onRenameLibrary).toHaveBeenCalledTimes(1);
  });
});
