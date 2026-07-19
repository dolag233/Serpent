/**
 * Coalesced, seek-aware media seeking for custom-protocol playback.
 *
 * Scrub UIs that assign `HTMLMediaElement.currentTime` on every pointermove
 * cancel in-flight Range fetches. Under `serpent://` that race frequently
 * ends in MEDIA_ERR_NETWORK and a fatal viewer error overlay (Serpent-jh2).
 *
 * This session:
 * - coalesces requests to one apply per animation frame
 * - never starts a new seek while `media.seeking` is true (queues latest)
 * - flushes the pending target on pointer-up / seeked
 */

export interface SeekableMediaLike {
  currentTime: number;
  duration: number;
  readyState: number;
  seeking: boolean;
}

export interface FrameScheduler {
  schedule(callback: () => void): number;
  cancel(handle: number): void;
}

const DEFAULT_SCHEDULER: FrameScheduler = {
  schedule: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** Ignore micro-moves that would only churn Range requests. */
export const MEDIA_SEEK_EPSILON_SECONDS = 0.04;

/** HAVE_METADATA — duration is known enough to seek. */
const HAVE_METADATA = 1;

export function canCommitMediaSeek(media: SeekableMediaLike | null): boolean {
  if (!media) return false;
  if (media.readyState < HAVE_METADATA) return false;
  return Number.isFinite(media.duration) && media.duration > 0;
}

export function shouldApplyMediaSeek(
  media: SeekableMediaLike,
  targetTime: number,
): boolean {
  if (!canCommitMediaSeek(media)) return false;
  if (!Number.isFinite(targetTime)) return false;
  return Math.abs(media.currentTime - targetTime) >= MEDIA_SEEK_EPSILON_SECONDS;
}

export interface MediaSeekSession {
  /** Queue a seek target (coalesced to the next animation frame). */
  request(time: number): void;
  /**
   * Commit a definitive seek (pointer-up / key). Cancels coalescing and applies
   * immediately unless a seek is already in flight (then queues for `onSeeked`).
   */
  commit(time: number): void;
  /** Apply any pending target immediately (pointer-up without a final ratio). */
  flush(): void;
  /** Call from the element's `seeked` handler so a queued target can run. */
  onSeeked(): void;
  /** Drop pending work (unmount / src change). */
  cancel(): void;
}

export function createMediaSeekSession(
  getMedia: () => SeekableMediaLike | null,
  applySeek: (time: number) => void,
  scheduler: FrameScheduler = DEFAULT_SCHEDULER,
): MediaSeekSession {
  let pending: number | null = null;
  let frameHandle = 0;

  const applyTarget = (time: number): void => {
    const media = getMedia();
    if (!media || !shouldApplyMediaSeek(media, time)) return;
    if (media.seeking) {
      pending = time;
      return;
    }
    applySeek(time);
  };

  const runFrame = (): void => {
    frameHandle = 0;
    if (pending === null) return;
    const media = getMedia();
    if (media?.seeking) {
      // Keep `pending`; `onSeeked` will flush.
      return;
    }
    const time = pending;
    pending = null;
    applyTarget(time);
  };

  const clearFrame = (): void => {
    if (frameHandle === 0) return;
    scheduler.cancel(frameHandle);
    frameHandle = 0;
  };

  return {
    request(time: number) {
      pending = time;
      if (frameHandle !== 0) return;
      frameHandle = scheduler.schedule(runFrame);
    },
    commit(time: number) {
      clearFrame();
      pending = null;
      applyTarget(time);
    },
    flush() {
      clearFrame();
      if (pending === null) return;
      const time = pending;
      pending = null;
      applyTarget(time);
    },
    onSeeked() {
      if (pending === null) return;
      const time = pending;
      pending = null;
      applyTarget(time);
    },
    cancel() {
      clearFrame();
      pending = null;
    },
  };
}

/**
 * MEDIA_ERR_ABORTED is expected when Chromium cancels a Range fetch because a
 * newer seek superseded it. Surfacing that as a fatal viewer error is wrong.
 */
export function isTransientMediaPlaybackError(
  mediaError: { code: number } | null | undefined,
): boolean {
  if (!mediaError) return false;
  // 1 = MEDIA_ERR_ABORTED
  return mediaError.code === 1;
}
