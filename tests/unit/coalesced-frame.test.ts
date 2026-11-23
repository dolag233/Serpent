import { describe, expect, it } from "vitest";
import { createCoalescedFrame } from "../../src/renderer/coalesced-frame";
import { advanceLibraryViewSession, isCurrentLibraryViewSession, type LibraryViewSession } from "../../src/renderer/library-view-session";

function clock() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 0;
  return {
    requestAnimationFrame(callback: FrameRequestCallback) { callbacks.set(++next, callback); return next; },
    cancelAnimationFrame(id: number) { callbacks.delete(id); },
    tick(now = 0) {
      const batch = [...callbacks.values()];
      callbacks.clear();
      for (const callback of batch) callback(now);
    },
  };
}

describe("coalesced viewport reporting", () => {
  it.each(["switch", "reopen", "return"])("rejects stale owners before consuming a frame deadline (%s)", (transition) => {
    const frames = clock();
    const cadence = { intervalMs: 80, lastPublishedAt: 0 };
    const owner = { libraryId: "library-a", generation: 1 };
    let current: LibraryViewSession = owner;
    let sent = 0;
    const outgoing = createCoalescedFrame(() => { sent += 1; }, frames, cadence,
      () => isCurrentLibraryViewSession(current, owner));
    outgoing.request();
    frames.tick(16); // A frame is waiting for the shared 80ms deadline.
    current = advanceLibraryViewSession(current, transition === "reopen" ? "library-a" : "library-b");
    if (transition === "return") current = advanceLibraryViewSession(current, "library-a");
    frames.tick(80);
    outgoing.request();
    frames.tick(96);
    expect(sent).toBe(0);
    expect(cadence.lastPublishedAt).toBe(0);
    const incoming = createCoalescedFrame(() => { sent += 1; }, frames, cadence);
    incoming.request();
    frames.tick(96);
    expect(sent).toBe(1);
  });

  it("publishes the latest scroll position once when many events arrive before paint", () => {
    const frames = clock();
    let position = 0;
    const sent: number[] = [];
    const report = createCoalescedFrame(() => sent.push(position), frames);
    for (let next = 1; next <= 100; next += 1) { position = next; report.request(); }
    expect(sent).toEqual([]);
    frames.tick();
    expect(sent).toEqual([100]);
    frames.tick();
    expect(sent).toEqual([100]);
  });

  it("keeps reporting during continuous scrolling instead of waiting for inactivity", () => {
    const frames = clock();
    const sent: number[] = [];
    let position = 0;
    const report = createCoalescedFrame(() => sent.push(position), frames);
    for (position = 1; position <= 60; position += 1) {
      report.request();
      report.request();
      frames.tick();
    }
    expect(sent).toEqual(Array.from({ length: 60 }, (_, index) => index + 1));
  });

  it("cancels an outgoing view and permits a new publication", () => {
    const frames = clock();
    let sent = 0;
    const report = createCoalescedFrame(() => { sent += 1; }, frames);
    report.request();
    report.cancel();
    frames.tick();
    expect(sent).toBe(0);
    report.request();
    frames.tick();
    expect(sent).toBe(1);
  });

  it("limits ongoing publication with a fixed deadline instead of postponing it on every event", () => {
    const frames = clock();
    const cadence = { intervalMs: 80, lastPublishedAt: -Infinity };
    let now = 0;
    const sent: number[] = [];
    const report = createCoalescedFrame(() => sent.push(now), frames, cadence);
    for (now = 0; now <= 192; now += 16) {
      report.request();
      frames.tick(now);
    }
    expect(sent).toEqual([0, 80, 160]);
  });

  it("retains the deadline across geometry-driven owner replacements", () => {
    const frames = clock();
    const cadence = { intervalMs: 80, lastPublishedAt: -Infinity };
    const sent: number[] = [];
    let now = 0;
    let report = createCoalescedFrame(() => sent.push(now), frames, cadence);
    report.request();
    frames.tick(now);
    for (now = 16; now <= 96; now += 16) {
      report.cancel();
      report = createCoalescedFrame(() => sent.push(now), frames, cadence);
      report.request();
      frames.tick(now);
    }
    expect(sent).toEqual([0, 80]);
    report.cancel();
  });
});
