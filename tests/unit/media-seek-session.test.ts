import { describe, expect, it } from "vitest";

import {
  canCommitMediaSeek,
  createMediaSeekSession,
  isTransientMediaPlaybackError,
  MEDIA_SEEK_EPSILON_SECONDS,
  shouldApplyMediaSeek,
  type FrameScheduler,
  type SeekableMediaLike,
} from "../../src/renderer/media-seek-session";

function media(partial: Partial<SeekableMediaLike>): SeekableMediaLike {
  return {
    currentTime: 0,
    duration: 100,
    readyState: 1,
    seeking: false,
    ...partial,
  };
}

function manualScheduler(): FrameScheduler & {
  flush(): void;
  pendingCount(): number;
} {
  const queue: Array<() => void> = [];
  return {
    schedule(callback) {
      queue.push(callback);
      return queue.length;
    },
    cancel(handle) {
      queue[handle - 1] = () => undefined;
    },
    flush() {
      const callbacks = queue.splice(0);
      for (const callback of callbacks) callback();
    },
    pendingCount() {
      return queue.length;
    },
  };
}

describe("canCommitMediaSeek / shouldApplyMediaSeek", () => {
  it("requires metadata-ready finite duration", () => {
    expect(canCommitMediaSeek(null)).toBe(false);
    expect(canCommitMediaSeek(media({ readyState: 0 }))).toBe(false);
    expect(canCommitMediaSeek(media({ duration: Number.NaN }))).toBe(false);
    expect(canCommitMediaSeek(media({ duration: 0 }))).toBe(false);
    expect(canCommitMediaSeek(media({ duration: 12 }))).toBe(true);
  });

  it("skips no-op seeks inside the epsilon window", () => {
    const element = media({ currentTime: 10 });
    expect(shouldApplyMediaSeek(element, 10)).toBe(false);
    expect(
      shouldApplyMediaSeek(element, 10 + MEDIA_SEEK_EPSILON_SECONDS / 2),
    ).toBe(false);
    expect(shouldApplyMediaSeek(element, 10.5)).toBe(true);
  });
});

describe("createMediaSeekSession", () => {
  it("coalesces many request() calls into one apply per frame", () => {
    const applied: number[] = [];
    const element = media({ currentTime: 0 });
    const scheduler = manualScheduler();
    const session = createMediaSeekSession(
      () => element,
      (time) => {
        applied.push(time);
        element.currentTime = time;
        element.seeking = true;
      },
      scheduler,
    );

    session.request(1);
    session.request(2);
    session.request(3);
    expect(applied).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.flush();
    expect(applied).toEqual([3]);
  });

  it("does not start a second seek while seeking; applies queued target on seeked", () => {
    const applied: number[] = [];
    const element = media({ currentTime: 0, seeking: true });
    const scheduler = manualScheduler();
    const session = createMediaSeekSession(
      () => element,
      (time) => {
        applied.push(time);
        element.currentTime = time;
        element.seeking = true;
      },
      scheduler,
    );

    session.request(40);
    scheduler.flush();
    expect(applied).toEqual([]);

    element.seeking = false;
    session.onSeeked();
    expect(applied).toEqual([40]);
  });

  it("commit() applies immediately when not seeking", () => {
    const applied: number[] = [];
    const element = media({ currentTime: 0 });
    const scheduler = manualScheduler();
    const session = createMediaSeekSession(
      () => element,
      (time) => {
        applied.push(time);
        element.currentTime = time;
      },
      scheduler,
    );

    session.request(10);
    session.commit(55);
    expect(applied).toEqual([55]);
    // Cancelled frame may remain as a no-op slot; flush must not apply 10.
    scheduler.flush();
    expect(applied).toEqual([55]);
  });
});

describe("isTransientMediaPlaybackError", () => {
  it("treats MEDIA_ERR_ABORTED as transient seek cancel", () => {
    expect(isTransientMediaPlaybackError({ code: 1 })).toBe(true);
    expect(isTransientMediaPlaybackError({ code: 2 })).toBe(false);
    expect(isTransientMediaPlaybackError(null)).toBe(false);
  });
});
