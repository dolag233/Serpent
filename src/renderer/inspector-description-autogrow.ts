/**
 * Height (px) to apply to the Inspector description textarea (Serpent-qto):
 * default single-line height, growing only as far as `scrollHeight` demands
 * once content wraps past one line, clamped to a maximum so very long
 * descriptions scroll internally instead of pushing the rest of the
 * Inspector off-screen.
 */
export function resolveAutoGrowHeight(
  scrollHeight: number,
  minHeight: number,
  maxHeight: number,
): number {
  if (maxHeight < minHeight) return minHeight;
  return Math.min(maxHeight, Math.max(minHeight, scrollHeight));
}
