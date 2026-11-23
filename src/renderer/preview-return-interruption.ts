import { canvasHasPreviewScrollHold } from "./browse-scroll-debug";

export type PreviewReturnInterruptionInput = {
  canvas: HTMLElement | null;
  viewerOpen: boolean;
  restoring: boolean;
  generationRef: { current: number };
  cancelRestoreRef: { current: (() => void) | null };
  focusFrameRef: { current: number | null };
  closingAssetRef: { current: string | null };
  clearHold: () => void;
  onInterrupted: () => void;
};

/**
 * Releases a pending viewer-return owner before a user-driven canvas reflow.
 * This helper owns no scroll geometry or asset state; App supplies the
 * synchronous state transition after the old return callbacks are invalidated.
 */
export function interruptPreviewReturnForReflow(
  input: PreviewReturnInterruptionInput,
): boolean {
  if (input.viewerOpen) return false;

  const hasPendingReturn = input.restoring
    || input.cancelRestoreRef.current !== null
    || input.focusFrameRef.current !== null
    || canvasHasPreviewScrollHold(input.canvas);
  if (!hasPendingReturn) return true;

  input.generationRef.current += 1;
  const cancelRestore = input.cancelRestoreRef.current;
  input.cancelRestoreRef.current = null;
  cancelRestore?.();

  const focusFrame = input.focusFrameRef.current;
  input.focusFrameRef.current = null;
  if (focusFrame !== null) globalThis.cancelAnimationFrame(focusFrame);

  input.closingAssetRef.current = null;
  input.clearHold();
  input.onInterrupted();
  return true;
}
