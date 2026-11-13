// Keep these dimensions aligned with .preview-nav in styles.css.
const EDGE_RATIO = 0.08;
const EDGE_MIN_PX = 56;
const EDGE_MAX_PX = 80;
const VERTICAL_INSET_RATIO = 0.22;

export function viewerNavigationSide(
  bounds: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): "prev" | "next" | null {
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  const inset = bounds.height * VERTICAL_INSET_RATIO;
  if (x < 0 || x > bounds.width || y < inset || y > bounds.height - inset) {
    return null;
  }
  const edge = Math.min(Math.max(bounds.width * EDGE_RATIO, EDGE_MIN_PX), EDGE_MAX_PX);
  if (x <= edge) return "prev";
  if (bounds.width - x <= edge) return "next";
  return null;
}
