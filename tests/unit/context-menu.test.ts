// @vitest-environment happy-dom
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuProvider,
} from "../../src/renderer/context-menu";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("ContextMenu focus lifecycle", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  it("does not overwrite a menu-item focus received before initial focus settles", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(
            ContextMenuProvider,
            null,
            createElement(
              ContextMenu,
              {
                ariaLabel: "Asset actions",
                position: { x: 20, y: 20 },
                children: createElement(
                  Fragment,
                  null,
                  createElement(ContextMenuItem, {
                    label: "First",
                    onAction: () => undefined,
                  }),
                  createElement(ContextMenuItem, {
                    label: "Hovered",
                    onAction: () => undefined,
                  }),
                ),
              },
            ),
          ),
        ),
      );
    });

    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(items).toHaveLength(2);

    // Model mouseenter focusing an item before ContextMenu's post-mount frame.
    items[1]?.focus();
    expect(document.activeElement).toBe(items[1]);

    await act(async () => {
      animationFrames.forEach((callback) => callback(performance.now()));
    });

    expect(document.activeElement).toBe(items[1]);
  });

  it("marks destructive context-menu actions for the shared danger style", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(
            ContextMenuProvider,
            null,
            createElement(ContextMenu, {
              ariaLabel: "Asset actions",
              position: { x: 20, y: 20 },
              children: createElement(ContextMenuItem, {
                danger: true,
                label: "Delete permanently",
                onAction: () => undefined,
              }),
            }),
          ),
        ),
      );
    });

    const item = container.querySelector<HTMLButtonElement>(
      '[role="menuitem"]',
    );
    expect(item?.classList.contains("is-danger")).toBe(true);
  });

  it("uses the keyboard focus marker for arrow navigation", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(
            ContextMenuProvider,
            null,
            createElement(
              ContextMenu,
              {
                ariaLabel: "Asset actions",
                position: { x: 20, y: 20 },
                children: createElement(
                  Fragment,
                  null,
                  createElement(ContextMenuItem, {
                    label: "First",
                    onAction: () => undefined,
                  }),
                  createElement(ContextMenuItem, {
                    label: "Second",
                    onAction: () => undefined,
                  }),
                ),
              },
            ),
          ),
        ),
      );
    });

    const menu = container.querySelector<HTMLElement>('[role="menu"]');
    const items = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
    );
    expect(menu).not.toBeNull();
    items[0]?.focus();
    await act(async () => {
      items[0]?.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "ArrowDown",
          code: "ArrowDown",
        }),
      );
    });

    expect(menu?.classList.contains("is-keyboard-navigation")).toBe(true);
    expect(document.activeElement).toBe(items[1]);
  });
});
