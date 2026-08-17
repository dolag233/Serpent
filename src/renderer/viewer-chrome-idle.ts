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
 * Sources of viewer activity that can interrupt idle-faded chrome
 * (Serpent-njoy). Product rule (2026-07-25): **any** keyboard / pointer /
 * wheel input wakes chrome and restarts the idle timer. Supersedes
 * VIEWER-010 / Serpent-ayf (keyboard nav / clicks used to leave chrome
 * hidden).
 */
export type ViewerChromeActivitySource =
  | "pointermove"
  | "pointerdownOrClick"
  | "keyboard"
  | "wheel"
  | "other";

export function shouldWakeViewerChrome(
  source: ViewerChromeActivitySource,
): boolean {
  void source;
  return true;
}
