export const VIEWPORT_REPORT_INTERVAL_MS = 80;

export type FrameCadence = { intervalMs: number; lastPublishedAt: number };

/** Keep the latest state readable while publishing at most once per frame.
 * Optional cadence survives owner replacement without restarting its deadline.
 */
export function createCoalescedFrame(
  publish: () => void,
  frames: Pick<Window, "requestAnimationFrame" | "cancelAnimationFrame"> = window,
  cadence?: FrameCadence,
  isCurrent?: () => boolean,
) {
  let pending: number | undefined;
  const tick: FrameRequestCallback = (now) => {
    if (isCurrent && !isCurrent()) {
      pending = undefined;
      return;
    }
    if (cadence && now - cadence.lastPublishedAt < cadence.intervalMs) {
      pending = frames.requestAnimationFrame(tick);
      return;
    }
    pending = undefined;
    if (cadence) cadence.lastPublishedAt = now;
    publish();
  };
  return {
    request() {
      if (pending !== undefined || (isCurrent && !isCurrent())) return;
      pending = frames.requestAnimationFrame(tick);
    },
    cancel() {
      if (pending !== undefined) frames.cancelAnimationFrame(pending);
      pending = undefined;
    },
  };
}
