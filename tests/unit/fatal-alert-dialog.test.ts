// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FatalAlertDialog } from "../../src/renderer/FatalAlertDialog";
import { LocaleProvider } from "../../src/renderer/i18n";
import { useDialogFocusTrap } from "../../src/renderer/use-dialog-focus-trap";

function FocusTrapHarness({ children }: { children: ReactNode }) {
  useDialogFocusTrap(true);
  return children;
}

describe("FatalAlertDialog library recovery action", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("offers a direct switch-library action after a failed operation", async () => {
    const onSwitchLibrary = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(FatalAlertDialog, {
            message: "无法打开资源库",
            onDismiss: vi.fn(),
            onSwitchLibrary,
          }),
        ),
      );
    });

    const switchButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "切换资源库",
    );
    expect(switchButton).toBeDefined();
    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSwitchLibrary).toHaveBeenCalledTimes(1);
  });

  it("marks the blocking alert as a modal that the global focus trap can own", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(FatalAlertDialog, {
            message: "无法打开资源库",
            onDismiss: vi.fn(),
          }),
        ),
      );
    });

    const alert = container.querySelector('[role="alertdialog"]');
    expect(alert).toBeTruthy();
    expect(alert?.getAttribute("aria-modal")).toBe("true");
  });

  it("keeps Tab focus inside the blocking alert", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(
            FocusTrapHarness,
            null,
            createElement(FatalAlertDialog, {
              message: "无法打开资源库",
              onDismiss: vi.fn(),
              onSwitchLibrary: vi.fn(),
            }),
          ),
        ),
      );
    });

    const alert = container.querySelector('[role="alertdialog"]');
    const focusable = [
      ...alert!.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    ];
    expect(focusable.length).toBeGreaterThan(1);
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(document.activeElement).toBe(first);
  });
});
