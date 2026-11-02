/**
 * Geometry changes are rare; scrolling is frequent. Capture the mounted
 * canvas anchor synchronously before a geometry state update, rather than
 * forcing layout on every scroll frame just in case a later patch arrives.
 */
const activeAnchorCaptures = new Set<() => void>();

export function registerVirtualScrollAnchorCapture(capture: () => void): () => void {
  activeAnchorCaptures.add(capture);
  return () => activeAnchorCaptures.delete(capture);
}

export function captureVirtualScrollAnchorsBeforeGeometryChange(): void {
  for (const capture of activeAnchorCaptures) capture();
}
