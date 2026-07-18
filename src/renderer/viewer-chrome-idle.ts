/**
 * Schedule viewer chrome idle fade. Call `bump()` to show chrome and restart
 * the idle timer; `dispose()` clears any pending timeout.
 */
export function createViewerChromeIdleScheduler(
  idleMs: number,
  onIdle: () => void,
  onActive?: () => void,
): { bump: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  const bump = () => {
    onActive?.();
    clearTimeout(timer);
    timer = setTimeout(onIdle, idleMs);
  };
  const dispose = () => clearTimeout(timer);
  return { bump, dispose };
}

/**
 * Sources of viewer activity that can request idle-faded chrome to wake back
 * up (Serpent-ayf). Only genuine pointer/mouse movement should wake it —
 * clicking the on-screen prev/next affordances, and keyboard arrow-key asset
 * navigation, must leave idle-faded chrome hidden. Pointer-down (clicks) is
 * included as a named, explicitly-rejected source rather than simply being
 * unwired, so future call sites cannot silently reintroduce click-wakes.
 */
export type ViewerChromeActivitySource = "pointermove" | "pointerdownOrClick";

export function shouldWakeViewerChrome(
  source: ViewerChromeActivitySource,
): boolean {
  return source === "pointermove";
}
