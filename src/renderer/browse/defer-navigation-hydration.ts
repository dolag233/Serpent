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
export type NavigationHydrationOptions = Readonly<{
  /** Cancel the queued idle work when a newer library/scope wins. */
  signal?: AbortSignal;
  /** Library replacement is urgent and may start after the next paint. */
  immediate?: boolean;
}>;

export function deferNavigationHydration<T>(
  load: () => Promise<T>,
  options: NavigationHydrationOptions = {},
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    let settled = false;
    let cleanup = () => undefined;
    const settleCancelled = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(undefined);
    };
    const runAfterPaint = () => {
      let started = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const canvas = typeof document !== "undefined"
        ? document.querySelector<HTMLElement>(".workspace-canvas")
        : null;
      cleanup = () => {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        canvas?.removeEventListener("scroll", scheduleQuietStart);
        options.signal?.removeEventListener("abort", settleCancelled);
      };
      const start = () => {
        if (started || settled || options.signal?.aborted) {
          settleCancelled();
          cleanup();
          return;
        }
        started = true;
        cleanup();
        void Promise.resolve().then(load).then(
          (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          },
          (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
          },
        );
      };
      function scheduleQuietStart() {
        if (idleTimer !== undefined) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          start,
          options.immediate ? 0 : NAVIGATION_IDLE_DELAY_MS,
        );
      }

      canvas?.addEventListener("scroll", scheduleQuietStart, { passive: true });
      options.signal?.addEventListener("abort", settleCancelled, { once: true });
      if (options.signal?.aborted) {
        settleCancelled();
        cleanup();
      } else {
        scheduleQuietStart();
      }
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
