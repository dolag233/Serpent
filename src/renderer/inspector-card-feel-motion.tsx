import { useEffect } from "react";

import {
  INSPECTOR_CARD_FEEL_TILT_SELECTOR,
  applyCardFeelTilt,
  captureCardFeelTiltRect,
  resetCardFeelTilt,
  setCardFeelPressing,
  type CardFeelTiltRect,
} from "./card-feel-tilt";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Inspector-only trading-card tilt (experiment/card-feel-preview subset).
 * Scoped to `.inspector-pane [data-card-feel-tilt]` — browse grid unchanged.
 */
export function InspectorCardFeelMotion(): null {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    let active: HTMLElement | null = null;
    let layoutRect: CardFeelTiltRect | null = null;

    const clearActive = () => {
      if (!active) return;
      resetCardFeelTilt(active);
      active = null;
      layoutRect = null;
    };

    const resolveTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof Element)) return null;
      if (!eventTarget.closest(".inspector-pane")) return null;
      return eventTarget.closest(
        INSPECTOR_CARD_FEEL_TILT_SELECTOR,
      ) as HTMLElement | null;
    };

    const ensureLayoutRect = (target: HTMLElement): CardFeelTiltRect => {
      if (active === target && layoutRect) return layoutRect;
      const next = captureCardFeelTiltRect(target);
      layoutRect = next;
      return next;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons === 2) return;
      const target = resolveTarget(event.target);
      if (!target) {
        clearActive();
        return;
      }
      if (active && active !== target) {
        resetCardFeelTilt(active);
        layoutRect = null;
      }
      const rect = ensureLayoutRect(target);
      active = target;
      applyCardFeelTilt(target, event.clientX, event.clientY, rect);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = resolveTarget(event.target);
      if (!target) return;
      if (active && active !== target) {
        resetCardFeelTilt(active);
        layoutRect = null;
      }
      const rect = ensureLayoutRect(target);
      active = target;
      applyCardFeelTilt(target, event.clientX, event.clientY, rect);
      setCardFeelPressing(target, true);
    };

    const onPointerUp = () => {
      if (active) setCardFeelPressing(active, false);
    };

    const onPointerCancel = () => {
      clearActive();
    };

    const onDragStart = () => {
      clearActive();
    };

    const onScroll = () => {
      clearActive();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("pointercancel", onPointerCancel, {
      passive: true,
    });
    window.addEventListener("dragstart", onDragStart, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      clearActive();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("dragstart", onDragStart);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, []);

  return null;
}
