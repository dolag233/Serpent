export const CANVAS_LAYOUT_COMMITTED_EVENT = "serpent:canvas-layout-committed";

/** Bubble after a virtual layout's mounted DOM has committed. */
export function notifyCanvasLayoutCommitted(element: HTMLElement): void {
  element.dispatchEvent(new Event(CANVAS_LAYOUT_COMMITTED_EVENT, { bubbles: true }));
}
