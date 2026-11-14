import { useEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";

import { contentRectFromPoints, rectsIntersect } from "./marquee-geometry";
import type { MarqueeModifierSnapshot } from "./marquee-selection";

type MarqueeUpdate = (
  hitIds: string[],
  initialIds: string[],
  modifiers: MarqueeModifierSnapshot,
) => void;

const DRAG_THRESHOLD_PX = 4;
const TAG_SELECTOR = "[data-tag-selection-id]";

/** Geometry and pointer lifecycle for the Inspector's compact tag grid. */
export function useTagMarquee(
  containerRef: RefObject<HTMLDivElement | null>,
  selectedIds: readonly string[],
  onUpdate: MarqueeUpdate,
) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  useEffect(() => () => cleanupRef.current?.(), []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target;
    if (!(target instanceof Element) || target.closest("input, textarea, .tag-chip-remove, .tag-input-wrapper")) return;
    const container = containerRef.current;
    if (!container) return;
    cleanupRef.current?.();
    const origin = container.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const startLocal = { x: start.x - origin.left, y: start.y - origin.top };
    const initialIds = [...selectedIds];
    const modifiers = {
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    const box = container.querySelector<HTMLElement>(".tag-selection-marquee");
    let dragging = false;
    const onMove = (move: globalThis.PointerEvent) => {
      if (move.pointerId !== event.pointerId) return;
      if (!dragging && Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      move.preventDefault();
      const bounds = container.getBoundingClientRect();
      const point = {
        x: Math.max(bounds.left, Math.min(move.clientX, bounds.right)),
        y: Math.max(bounds.top, Math.min(move.clientY, bounds.bottom)),
      };
      const rectangle = contentRectFromPoints(
        { x: bounds.left + startLocal.x, y: bounds.top + startLocal.y },
        point,
      );
      if (box) {
        box.style.display = "block";
        box.style.left = `${rectangle.left - bounds.left}px`;
        box.style.top = `${rectangle.top - bounds.top}px`;
        box.style.width = `${rectangle.right - rectangle.left}px`;
        box.style.height = `${rectangle.bottom - rectangle.top}px`;
      }
      const hitIds = [...container.querySelectorAll<HTMLElement>(TAG_SELECTOR)]
        .filter(element => rectsIntersect(rectangle, element.getBoundingClientRect()))
        .map(element => element.dataset.tagSelectionId)
        .filter((id): id is string => Boolean(id));
      onUpdate(hitIds, initialIds, modifiers);
    };
    const finish = (up: globalThis.PointerEvent) => {
      if (up.pointerId !== event.pointerId) return;
      cleanupRef.current?.();
      if (dragging) {
        suppressClickRef.current = true;
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      }
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      if (box) box.style.display = "none";
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  };

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}
