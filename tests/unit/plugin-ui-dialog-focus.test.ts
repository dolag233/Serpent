// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DIALOG_INITIAL_FOCUS_ATTRIBUTE,
  focusPluginWidgetDialogEditable,
  restoreDocumentKeyboardFocus,
  usePluginWidgetDialogKeyboardFocus,
} from "../../src/renderer/plugin-ui-dialog-focus";
import { useDialogFocusTrap } from "../../src/renderer/use-dialog-focus-trap";

describe("plugin widget dialog keyboard focus", () => {
  it("steals OS focus only when the document is inactive", () => {
    const focusWindow = vi.fn();
    const stealNativeFocus = vi.fn();
    expect(
      restoreDocumentKeyboardFocus({
        hasDocumentFocus: () => true,
        focusWindow,
        stealNativeFocus,
      }),
    ).toBe(false);
    expect(focusWindow).not.toHaveBeenCalled();
    expect(stealNativeFocus).not.toHaveBeenCalled();
    expect(
      restoreDocumentKeyboardFocus({
        hasDocumentFocus: () => false,
        focusWindow,
        stealNativeFocus,
      }),
    ).toBe(true);
    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(stealNativeFocus).toHaveBeenCalledTimes(1);
  });

  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("marks and focuses the first editable field", () => {
    container = document.createElement("div");
    document.body.append(container);
    container.innerHTML = `
      <div id="plugin-dialog" role="dialog" aria-modal="true">
        <button type="button" class="primary-button">Apply</button>
        <input id="prefix" />
        <input id="suffix" />
      </div>
    `;
    const dialog = container.querySelector("#plugin-dialog");
    const focused = focusPluginWidgetDialogEditable(
      dialog instanceof HTMLElement ? dialog : null,
    );
    const prefix = container.querySelector("#prefix");
    expect(focused).toBe(prefix);
    expect(prefix?.getAttribute(DIALOG_INITIAL_FOCUS_ATTRIBUTE)).toBe("true");
    expect(document.activeElement).toBe(prefix);
  });

  it("lets the shared trap prefer the marked field over the primary button", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function Harness() {
      useDialogFocusTrap(true);
      return createElement(
        "div",
        { role: "dialog", "aria-modal": "true" },
        createElement("input", {
          id: "prefix",
          [DIALOG_INITIAL_FOCUS_ATTRIBUTE]: "true",
        }),
        createElement(
          "button",
          { className: "primary-button", type: "button" },
          "Apply",
        ),
      );
    }

    await act(async () => {
      root?.render(createElement(Harness));
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    });
    expect(document.activeElement?.id).toBe("prefix");
  });

  it("refocuses the first field when the window is activated", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    function Harness() {
      usePluginWidgetDialogKeyboardFocus("plugin-dialog");
      return createElement(
        "div",
        { id: "plugin-dialog", role: "dialog", "aria-modal": "true" },
        createElement("input", { id: "prefix" }),
        createElement(
          "button",
          { className: "primary-button", type: "button" },
          "Apply",
        ),
      );
    }

    await act(async () => {
      root?.render(createElement(Harness));
    });
    const prefix = container.querySelector("#prefix");
    const apply = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Apply",
    );
    expect(document.activeElement).toBe(prefix);
    await act(async () => {
      apply?.focus();
    });
    expect(document.activeElement).toBe(apply);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(document.activeElement).toBe(apply);
    await act(async () => {
      apply?.blur();
      window.dispatchEvent(new Event("focus"));
    });
    expect(document.activeElement).toBe(prefix);
  });
});
