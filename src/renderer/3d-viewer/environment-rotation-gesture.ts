/**
 * Pointer gesture policy for rotating the HDRI independently from the model.
 *
 * Right-drag remains available for a mouse, while Ctrl+left-drag also starts
 * the gesture so macOS trackpads and Windows mice can use the same action.
 */

export interface EnvironmentRotationPointerStart {
  readonly button: number;
  readonly ctrlKey: boolean;
}

export function startsEnvironmentRotation(
  event: EnvironmentRotationPointerStart,
): boolean {
  return event.button === 2 || (event.button === 0 && event.ctrlKey);
}

export function environmentYawDelta(
  previousClientX: number,
  currentClientX: number,
): number {
  // A full-width drag is roughly half a turn in a typical viewer viewport.
  return (previousClientX - currentClientX) * 0.005;
}
