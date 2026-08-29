import { describe, expect, it } from "vitest";

import {
  createLibraryTransitionLock,
  LibraryTransitionInProgressError,
} from "../../src/renderer/library-transition-lock";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("library transition lock", () => {
  it("keeps a transition behind an active write and rejects writes submitted after it", async () => {
    const lock = createLibraryTransitionLock();
    const writeGate = deferred();
    const events: string[] = [];

    const write = lock.runWrite(async () => {
      events.push("write-start");
      await writeGate.promise;
      events.push("write-end");
    });
    await Promise.resolve();

    const transition = lock(async () => {
      events.push("transition");
    });
    expect(lock.hasTransitionPending()).toBe(true);
    expect(lock.isTransitionRunning()).toBe(false);
    await expect(lock.runWrite(async () => undefined)).rejects.toBeInstanceOf(
      LibraryTransitionInProgressError,
    );

    writeGate.resolve();
    await Promise.all([write, transition]);
    expect(events).toEqual(["write-start", "write-end", "transition"]);
    expect(lock.hasTransitionPending()).toBe(false);
    expect(lock.isTransitionRunning()).toBe(false);
  });

  it("serializes multiple transitions in request order", async () => {
    const lock = createLibraryTransitionLock();
    const events: string[] = [];

    const first = lock(async () => {
      events.push("first-start");
      await Promise.resolve();
      events.push("first-end");
    });
    const second = lock(async () => {
      events.push("second");
    });

    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });
});
