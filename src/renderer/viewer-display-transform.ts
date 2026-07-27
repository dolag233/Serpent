export interface ViewerDisplayTransform {
  flipHorizontal: boolean;
  flipVertical: boolean;
  quarterTurns: number;
}

export const IDENTITY_VIEWER_DISPLAY_TRANSFORM: ViewerDisplayTransform = {
  flipHorizontal: false,
  flipVertical: false,
  quarterTurns: 0,
};

export function normalizeQuarterTurns(value: number): number {
  return ((Math.trunc(value) % 4) + 4) % 4;
}

export function viewerDisplayTransformCss(
  transform: ViewerDisplayTransform,
): string {
  const turns = normalizeQuarterTurns(transform.quarterTurns);
  const x = transform.flipHorizontal ? -1 : 1;
  const y = transform.flipVertical ? -1 : 1;
  return `scale(${x}, ${y}) rotate(${turns * 90}deg)`;
}

export function viewerDisplaySize(
  width: number,
  height: number,
  quarterTurns: number,
): { width: number; height: number } {
  return normalizeQuarterTurns(quarterTurns) % 2 === 1
    ? { width: height, height: width }
    : { width, height };
}
