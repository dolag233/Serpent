import { useEffect, useRef } from "react";

import {
  getDialogDefaultAction,
  shouldActivateDialogDefaultAction,
} from "./ui/patterns/dialog";

const FOCUSABLE_SELECTOR =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/**
 * When any modal dialog is open: trap Tab inside the topmost dialog, move
 * initial focus to the first focusable control, and restore prior focus on
 * close. Escape handling stays with the caller (Serpent-vvn).
 */
export function useDialogFocusTrap(active: boolean, focusKey?: string): void {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusFirst = () => {
      const modal = getTopmostModal();
      if (!modal) return;
      if (modal.contains(document.activeElement)) return;
      const defaultAction = getDialogDefaultAction(modal);
      if (defaultAction) {
        defaultAction.focus();
        return;
      }
      const focusable = modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      focusable[0]?.focus();
    };

    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === "Enter" &&
        !event.defaultPrevented &&
        !event.isComposing
      ) {
        const modal = getTopmostModal();
        const target = event.target;
        if (
          modal &&
          target instanceof Node &&
          modal.contains(target) &&
          shouldActivateDialogDefaultAction(target)
        ) {
          const defaultAction = getDialogDefaultAction(modal);
          if (defaultAction) {
            event.preventDefault();
            event.stopPropagation();
            defaultAction.click();
            return;
          }
        }
      }
      if (event.key !== "Tab") return;
      const modal = getTopmostModal();
      const focusable = modal?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      const previous = previousFocusRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [active, focusKey]);
}

function getTopmostModal(): HTMLElement | null {
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]',
    ),
  ).filter((modal) => !modal.hidden && modal.getAttribute("aria-hidden") !== "true");
  return modals.at(-1) ?? null;
}
