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

export type ViewerDisplayTransformAction =
  | "flip-horizontal"
  | "flip-vertical"
  | "reset"
  | "rotate-clockwise";

export function applyViewerDisplayTransformAction(
  transform: ViewerDisplayTransform,
  action: ViewerDisplayTransformAction,
): ViewerDisplayTransform {
  if (action === "rotate-clockwise") {
    return { ...transform, quarterTurns: transform.quarterTurns + 1 };
  }
  if (action === "flip-horizontal") {
    return { ...transform, flipHorizontal: !transform.flipHorizontal };
  }
  if (action === "flip-vertical") {
    return { ...transform, flipVertical: !transform.flipVertical };
  }
  return IDENTITY_VIEWER_DISPLAY_TRANSFORM;
}

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
