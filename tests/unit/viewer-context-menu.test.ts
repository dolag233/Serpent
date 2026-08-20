// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../src/renderer/i18n";
import { ViewerContextMenu } from "../../src/renderer/ViewerContextMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("ViewerContextMenu", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  it("offers asset copy with the platform shortcut and runs it", async () => {
    const onCopy = vi.fn();
    const onClose = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          {
            initialPreference: "zh-CN",
            children: createElement(ViewerContextMenu, {
              copyShortcut: "⌘C",
              flipHorizontal: false,
              flipVertical: false,
              fitShortcut: "Numpad .",
              isFullscreen: false,
              onCopy,
              onClose,
              onFit: () => undefined,
              onFlipHorizontal: () => undefined,
              onFlipVertical: () => undefined,
              onFullscreen: () => undefined,
              onRotate: () => undefined,
              position: { x: 20, y: 20 },
              transformable: true,
            }),
          },
        ),
      );
    });

    const copyItem = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("复制资产"));

    expect(copyItem?.textContent).toContain("⌘C");
    await act(async () => {
      copyItem?.click();
    });
    expect(onCopy).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
