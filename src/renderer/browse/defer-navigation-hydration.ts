const NAVIGATION_IDLE_DELAY_MS = 1_000;

/**
 * Keep the sidebar read model out of the first browse turn. The canvas posts
 * its geometry/page work while the first response is being committed; running
 * the comparatively expensive navigation summary in the same Worker turn
 * would otherwise queue behind the session open and ahead of that work.
 *
 * A paint boundary alone is not enough: a large library can still be laying
 * out its first virtual window when the next task runs. Require a quiet canvas
 * interval and restart that interval on scroll, so the summary becomes an
 * idle follow-up instead of competing with a scrollbar jump.
 */
export function deferNavigationHydration<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const runAfterPaint = () => {
      let started = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const canvas = typeof document !== "undefined"
        ? document.querySelector<HTMLElement>(".workspace-canvas")
        : null;
      const cleanup = () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        canvas?.removeEventListener("scroll", scheduleQuietStart);
      };
      const start = () => {
        if (started) return;
        started = true;
        cleanup();
        void load().then(resolve, reject);
      };
      function scheduleQuietStart() {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        idleTimer = setTimeout(start, NAVIGATION_IDLE_DELAY_MS);
      }

      canvas?.addEventListener("scroll", scheduleQuietStart, { passive: true });
      scheduleQuietStart();
    };

    if (
      typeof window !== "undefined"
      && typeof window.requestAnimationFrame === "function"
    ) {
      window.requestAnimationFrame(runAfterPaint);
      return;
    }
    setTimeout(runAfterPaint, 0);
  });
}
