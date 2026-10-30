/** Explicit measurement while native transitions pause rendering. */
export const CANVAS_LAYOUT_MEASURE = "serpent:canvas-layout-measure";
export function observeCanvasLayoutMeasure(element: HTMLElement, update: () => void): () => void {
  const canvas = element.closest<HTMLElement>(".workspace-canvas");
  canvas?.addEventListener(CANVAS_LAYOUT_MEASURE, update);
  return () => canvas?.removeEventListener(CANVAS_LAYOUT_MEASURE, update);
}

/** Width changes need one publication, then one virtual-window verification.
 * Only keep converging when vertical anchoring actually moves the viewport. */
export function settleCanvasLayout(
  canvas: Pick<HTMLElement, "scrollTop">,
  measure: () => void,
  restore: () => void,
): void {
  let moved = false;
  for (let pass = 0; pass < 3; pass++) {
    measure();
    const previousTop = canvas.scrollTop;
    restore();
    moved = Math.abs(canvas.scrollTop - previousTop) > 0.5;
    if (pass > 0 && !moved) break;
  }
  if (moved) measure();
}
