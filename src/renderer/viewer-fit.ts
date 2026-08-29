/**
 * Compute the scale that fits an image into a viewport using contain
 * (longest edge touches the window; the other edge may have letterbox).
 */
export function fitContainScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return 0;
  }
  return Math.min(viewportWidth / imageWidth, viewportHeight / imageHeight);
}

/** The scale range shared by wheel, keyboard, and the viewer range control. */
export const VIEWER_MIN_SCALE = 0.05;
export const VIEWER_MAX_SCALE = 8;

/** Clamp a zoom scale between actual-size floor/ceiling for the viewer. */
export function clampViewerScale(scale: number): number {
  return Math.min(VIEWER_MAX_SCALE, Math.max(VIEWER_MIN_SCALE, scale));
}

/**
 * Clamp pan so the image cannot be dragged past the viewport edges.
 * When the scaled image is smaller than the viewport on an axis, that
 * axis is locked to 0 (centered).
 */
export function clampViewerPan(
  x: number,
  y: number,
  imageWidth: number,
  imageHeight: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  if (
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    scale <= 0 ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return { x: 0, y: 0 };
  }
  const displayW = imageWidth * scale;
  const displayH = imageHeight * scale;
  const maxX = Math.max(0, (displayW - viewportWidth) / 2);
  const maxY = Math.max(0, (displayH - viewportHeight) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, y)) || 0,
  };
}

/** True when the current scale is effectively the fit scale. */
export function isAtFitScale(scale: number, fitScale: number): boolean {
  if (fitScale <= 0) return false;
  return Math.abs(scale - fitScale) <= Math.max(0.01, fitScale * 0.02);
}
