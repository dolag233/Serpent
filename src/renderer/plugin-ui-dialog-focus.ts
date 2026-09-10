import { useLayoutEffect } from "react";

import { resolveRendererPlatform } from "./renderer-platform";
import type { SerpentShellApi } from "../shared/external-url";

export const PLUGIN_WIDGET_EDITABLE_SELECTOR =
  "input:not(:disabled), textarea:not(:disabled), select:not(:disabled)";

export const DIALOG_INITIAL_FOCUS_ATTRIBUTE = "data-dialog-initial-focus";

const STEAL_FOCUS_COOLDOWN_MS = 400;

type RendererWindow = Window & {
  serpent?: {
    shell?: Pick<SerpentShellApi, "windowControl">;
  };
};

let lastStealNativeFocusAt = 0;

export function focusPluginWidgetDialogEditable(
  dialog: HTMLElement | null,
): HTMLElement | null {
  if (!(dialog instanceof HTMLElement)) return null;
  const first = dialog.querySelector<HTMLElement>(PLUGIN_WIDGET_EDITABLE_SELECTOR);
  if (first === null) return null;
  first.setAttribute(DIALOG_INITIAL_FOCUS_ATTRIBUTE, "true");
  first.focus({ preventScroll: true });
  return first;
}

function defaultStealNativeFocus(): Promise<unknown> | void {
  if (resolveRendererPlatform(navigator.userAgent) !== "windows") return;
  const now = Date.now();
  if (now - lastStealNativeFocusAt < STEAL_FOCUS_COOLDOWN_MS) return;
  lastStealNativeFocusAt = now;
  const shell = (window as RendererWindow).serpent?.shell;
  return shell?.windowControl("steal-focus");
}

/**
 * Chromium can keep an input as `activeElement` while `document.hasFocus()`
 * is false (Windows native file picker). Programmatic `.focus()` then does
 * nothing useful — call `window.focus()` and ask Main to focus the render
 * widget HWND, not the frameless shell.
 */
export function restoreDocumentKeyboardFocus(options?: {
  readonly hasDocumentFocus?: () => boolean;
  readonly focusWindow?: () => void;
  readonly stealNativeFocus?: () => Promise<unknown> | void;
}): boolean {
  const hasFocus = options?.hasDocumentFocus ?? (() => document.hasFocus());
  if (hasFocus()) return false;
  (options?.focusWindow ?? (() => window.focus()))();
  void (options?.stealNativeFocus ?? defaultStealNativeFocus)();
  return true;
}

/**
 * Widget dialogs open after an async plugin command, often from a context
 * menu. Do not steal OS focus on every pointerdown — that fought Main's
 * blur/activate cycle and SetFocus'd the wrong HWND. Focus the field now;
 * one delayed steal lets Main finish reactivating first.
 */
export function usePluginWidgetDialogKeyboardFocus(dialogId: string): void {
  useLayoutEffect(() => {
    const readDialog = (): HTMLElement | null => {
      const node = document.getElementById(dialogId);
      return node instanceof HTMLElement ? node : null;
    };

    const focusField = (event?: Event) => {
      const dialog = readDialog();
      if (dialog === null) return;
      const target = event?.target;
      if (
        target instanceof HTMLElement
        && dialog.contains(target)
        && target.matches(PLUGIN_WIDGET_EDITABLE_SELECTOR)
      ) {
        if (event?.type === "pointerdown") {
          restoreDocumentKeyboardFocus({
            stealNativeFocus: () => undefined,
          });
        }
        target.focus({ preventScroll: true });
        return;
      }
      if (dialog.contains(document.activeElement)) return;
      focusPluginWidgetDialogEditable(dialog);
    };

    focusField();
    const raf = requestAnimationFrame(() => {
      focusField();
    });
    const timer = window.setTimeout(focusField, 50);
    const stealTimer = window.setTimeout(() => {
      restoreDocumentKeyboardFocus();
      focusField();
    }, 80);
    window.addEventListener("focus", focusField);
    const dialog = readDialog();
    dialog?.addEventListener("pointerdown", focusField, true);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(stealTimer);
      window.removeEventListener("focus", focusField);
      dialog?.removeEventListener("pointerdown", focusField, true);
    };
  }, [dialogId]);
}
