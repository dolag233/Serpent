// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useViewerZoomPan,
  type UseViewerZoomPanApi,
} from "../../src/renderer/use-viewer-zoom-pan";
import { DEFAULT_SHORTCUT_BINDINGS, setShortcutOverride } from "../../src/shared/shortcut-bindings";
import { setShortcutRuntime } from "../../src/renderer/shortcut-runtime";

type HarnessProps = {
  onApi: (api: UseViewerZoomPanApi) => void;
};

function PanHarness({ onApi }: HarnessProps): ReactElement {
  const api = useViewerZoomPan({ imageWheelShortcut: true });
  useLayoutEffect(() => {
    const viewport = document.querySelector("[data-pan-harness]");
    if (!(viewport instanceof HTMLElement)) return;
    Object.defineProperty(viewport, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(viewport, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          bottom: 200,
          right: 200,
          width: 200,
          height: 200,
          toJSON() {},
        }) as DOMRect,
    });
    onApi(api);
  });
  return createElement("div", {
    ...api.viewportPointerHandlers,
    "data-pan-harness": "",
    "data-x": String(api.view.x),
    "data-y": String(api.view.y),
    "data-scale": String(api.view.scale),
    ref: api.viewportRef,
  });
}

function readPan(container: HTMLElement): { x: number; y: number } {
  const viewport = container.firstElementChild as HTMLElement;
  return {
    x: Number(viewport.dataset.x),
    y: Number(viewport.dataset.y),
  };
}

describe("useViewerZoomPan middle-button pan (Serpent-16cd1e)", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  let api: UseViewerZoomPanApi | undefined;

  beforeEach(() => {
    setShortcutRuntime("windows", DEFAULT_SHORTCUT_BINDINGS);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    container = document.createElement("div");
    document.body.append(container);
    // React 19 + vitest: allow act() outside testing-library.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    root = createRoot(container);
    act(() => {
      root!.render(
        createElement(PanHarness, {
          onApi: (next) => {
            api = next;
          },
        }),
      );
    });
    act(() => {
      api?.measureAndFit("reset", { w: 800, h: 800 });
      api?.zoomAt(100, 100, 4);
    });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    api = undefined;
    vi.unstubAllGlobals();
  });

  it("pans when Chromium only delivers mouse events for the middle button", () => {
    const viewport = container!.firstElementChild as HTMLElement;
    const before = readPan(container!);

    act(() => {
      viewport.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: 80,
          clientY: 90,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 1,
          buttons: 4,
          clientX: 120,
          clientY: 110,
        }),
      );
    });

    const after = readPan(container!);
    expect(after.x - before.x).toBe(40);
    expect(after.y - before.y).toBe(20);
  });

  it("zooms with small wheel deltas and honors a changed wheel binding", () => {
    const viewport = container!.firstElementChild as HTMLElement;
    const scale = () => Number(viewport.dataset.scale);
    const wheel = (altKey = false) => {
      const event = new WheelEvent("wheel", {
        bubbles: true, cancelable: true, deltaY: -10, clientX: 100, clientY: 100,
      });
      Object.defineProperty(event, "altKey", { value: altKey });
      return event;
    };
    const initial = scale();
    act(() => { viewport.dispatchEvent(wheel()); });
    expect(scale()).toBeGreaterThan(initial);
    setShortcutRuntime("windows", setShortcutOverride(DEFAULT_SHORTCUT_BINDINGS, "windows", "viewer.image.wheel-zoom", { key: "Wheel", altKey: true }));
    const afterDefault = scale();
    act(() => { viewport.dispatchEvent(wheel()); });
    expect(scale()).toBe(afterDefault);
    act(() => { viewport.dispatchEvent(wheel(true)); });
    expect(scale()).toBeGreaterThan(afterDefault);
  });

  it("still pans with the left mouse button via mousedown", () => {
    const viewport = container!.firstElementChild as HTMLElement;
    const before = readPan(container!);

    act(() => {
      viewport.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 80,
          clientY: 90,
        }),
      );
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          button: 0,
          buttons: 1,
          clientX: 100,
          clientY: 90,
        }),
      );
    });

    expect(readPan(container!).x - before.x).toBe(20);
  });

  it("does not consume global zoom keys while a modal owns a non-editable control", () => {
    const dialog = document.createElement("section");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const button = document.createElement("button");
    dialog.append(button);
    document.body.append(dialog);
    button.focus();
    const event = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    dialog.remove();
  });
});
