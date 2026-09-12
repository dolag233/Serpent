// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceTabs } from "../../src/renderer/WorkspaceTabs";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("WorkspaceTabs interaction contract", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function renderTabs(overrides: Partial<Parameters<typeof WorkspaceTabs>[0]> = {}) {
    const props = {
      tabs: [
        { id: "one", title: "All assets", icon: "file" as const },
        { id: "two", title: "Reference", icon: "folder" as const },
        { id: "three", title: "Favorites", icon: "collection" as const },
      ],
      activeTabId: "one",
      disabled: false,
      onSelect: vi.fn(),
      onAdd: vi.fn(),
      onClose: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides,
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(
        LocaleProvider,
        { initialPreference: "en", children: null },
        createElement(WorkspaceTabs, props),
      ));
    });
    return { ...props, container };
  }

  it("adds a tab only from the explicit plus button", async () => {
    const { onAdd, onSelect, container: host } = await renderTabs();
    const firstTab = host.querySelector('[role="tab"]') as HTMLButtonElement;
    await act(async () => {
      firstTab.click();
    });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("one");
    expect(onAdd).not.toHaveBeenCalled();

    const addButton = host.querySelector(".workspace-tab-add") as HTMLButtonElement;
    await act(async () => {
      addButton.click();
    });
    expect(onAdd).toHaveBeenCalledExactlyOnceWith();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("closes a tab without selecting it", async () => {
    const { onSelect, onClose, container: host } = await renderTabs();
    const closeButton = [...host.querySelectorAll<HTMLButtonElement>(".workspace-tab-close")][1]!;
    await act(async () => {
      closeButton.click();
    });
    expect(onClose).toHaveBeenCalledExactlyOnceWith("two");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("opens the tab context menu without selecting the tab", async () => {
    const { onSelect, onContextMenu, container: host } = await renderTabs();
    const secondTab = host.querySelectorAll(".workspace-tab")[1]!;
    await act(async () => {
      secondTab.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 44,
      }));
    });
    expect(onContextMenu).toHaveBeenCalledExactlyOnceWith("two", { x: 120, y: 44 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("supports Arrow navigation and Home/End without creating or closing tabs", async () => {
    const { onSelect, onAdd, onClose, container: host } = await renderTabs();
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const dispatchKey = async (index: number, key: string) => {
      await act(async () => {
        tabs[index]!.dispatchEvent(new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key,
        }));
      });
    };

    await dispatchKey(0, "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("two");
    expect(document.activeElement).toBe(tabs[1]);
    await dispatchKey(1, "ArrowRight");
    expect(onSelect).toHaveBeenLastCalledWith("three");
    await dispatchKey(2, "Home");
    expect(onSelect).toHaveBeenLastCalledWith("one");
    expect(document.activeElement).toBe(tabs[0]);
    await dispatchKey(0, "End");
    expect(onSelect).toHaveBeenLastCalledWith("three");
    expect(document.activeElement).toBe(tabs[2]);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("turns a vertical wheel into horizontal tab-strip scrolling", async () => {
    const { container: host } = await renderTabs();
    const list = host.querySelector(".workspace-tabs-list") as HTMLDivElement;
    let scrollLeft = 0;
    Object.defineProperty(list, "scrollWidth", { configurable: true, value: 800 });
    Object.defineProperty(list, "clientWidth", { configurable: true, value: 200 });
    Object.defineProperty(list, "scrollLeft", {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    });

    await act(async () => {
      list.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: 40,
      }));
    });
    expect(scrollLeft).toBe(40);

    await act(async () => {
      list.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 24,
        deltaY: 3,
      }));
    });
    expect(scrollLeft).toBe(64);
  });

  it("keeps Delete inside the tab strip and closes only that tab", async () => {
    const onParentKeyDown = vi.fn();
    const { onClose, container: host } = await renderTabs();
    document.addEventListener("keydown", onParentKeyDown);
    const secondTab = host.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!;

    await act(async () => {
      secondTab.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Delete",
      }));
    });

    expect(onClose).toHaveBeenCalledExactlyOnceWith("two");
    expect(onParentKeyDown).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onParentKeyDown);
  });
});
