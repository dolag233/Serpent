import { useEffect } from "react";

import {
  collectScrollablesAtPoint,
  isPointerNearScrollbarTrack,
} from "./scrollbar-visibility";

const SCROLLBAR_IDLE_MS = 900;

/**
 * Overlay scrollbars (Serpent-62wm): show a thumb only while the user is
 * actively scrolling or the pointer is near the scrollbar track — not when
 * the mouse merely hovers the scrollport content.
 */
export function useScrollbarActivity(): void {
  useEffect(() => {
    const scrollTimers = new WeakMap<Element, number>();
    const proximityElements = new Set<Element>();

    const clearProximity = (el: Element) => {
      el.classList.remove("is-scrollbar-proximity");
      proximityElements.delete(el);
    };

    const clearAllProximity = () => {
      for (const el of proximityElements) {
        el.classList.remove("is-scrollbar-proximity");
      }
      proximityElements.clear();
    };

    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.classList.add("is-scrollbar-active");
      const previous = scrollTimers.get(target);
      if (previous !== undefined) window.clearTimeout(previous);
      const next = window.setTimeout(() => {
        target.classList.remove("is-scrollbar-active");
        scrollTimers.delete(target);
      }, SCROLLBAR_IDLE_MS);
      scrollTimers.set(target, next);
    };

    const onPointerMove = (event: PointerEvent) => {
      const nextProximity = new Set<Element>();
      for (const el of collectScrollablesAtPoint(
        event.clientX,
        event.clientY,
      )) {
        if (isPointerNearScrollbarTrack(el, event.clientX, event.clientY)) {
          nextProximity.add(el);
          el.classList.add("is-scrollbar-proximity");
        }
      }
      for (const el of proximityElements) {
        if (!nextProximity.has(el)) clearProximity(el);
      }
      for (const el of nextProximity) proximityElements.add(el);
    };

    const onPointerLeave = (event: PointerEvent) => {
      if (event.relatedTarget !== null) return;
      clearAllProximity();
    };

    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    document.addEventListener("pointermove", onPointerMove, {
      capture: true,
      passive: true,
    });
    document.addEventListener("pointerleave", onPointerLeave, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerleave", onPointerLeave, true);
      clearAllProximity();
    };
  }, []);
}
