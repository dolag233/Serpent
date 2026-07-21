import { useEffect } from "react";

const SCROLLBAR_IDLE_MS = 900;

/**
 * While any element scrolls, mark it `.is-scrollbar-active` so overlay
 * scrollbars (Serpent-xqot) can show a thumb without hovering.
 */
export function useScrollbarActivity(): void {
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.classList.add("is-scrollbar-active");
      const previous = timers.get(target);
      if (previous !== undefined) window.clearTimeout(previous);
      const next = window.setTimeout(() => {
        target.classList.remove("is-scrollbar-active");
        timers.delete(target);
      }, SCROLLBAR_IDLE_MS);
      timers.set(target, next);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, true);
    };
  }, []);
}
