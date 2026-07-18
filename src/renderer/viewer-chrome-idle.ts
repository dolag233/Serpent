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
