import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ViewerSessionController,
  type ViewerSessionIdentity,
} from "../../src/renderer/viewer/viewer-session-controller";

const first: ViewerSessionIdentity = {
  libraryId: "library-1",
  assetId: "asset-1",
  revisionId: "revision-1",
};

const second: ViewerSessionIdentity = {
  ...first,
  assetId: "asset-2",
  revisionId: "revision-2",
};

describe("ViewerSessionController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one identity stable and aborts it when navigation replaces it", () => {
    const controller = new ViewerSessionController();
    const session = controller.start(first);
    expect(controller.start(first)).toBe(session);
    expect(session.viewerSessionId).toBe("viewer-1");

    const next = controller.start(second);
    expect(next.viewerSessionId).toBe("viewer-2");
    expect(session.signal.aborted).toBe(true);
    expect(controller.current(first)).toBeNull();
    expect(controller.current(second)).toBe(next);
  });

  it("fences late preview responses with a latest-wins request token", () => {
    const controller = new ViewerSessionController();
    const session = controller.start(first);
    const oldRequest = controller.beginRequest(session)!;
    const newRequest = controller.beginRequest(session)!;

    expect(oldRequest.isCurrent()).toBe(false);
    expect(newRequest.isCurrent()).toBe(true);

    controller.invalidate();
    expect(newRequest.isCurrent()).toBe(false);
    expect(newRequest.signal.aborted).toBe(true);
  });

  it("cancels a superseded auxiliary task and claims the initial request once", () => {
    const controller = new ViewerSessionController();
    const session = controller.start(first);
    const firstTask = controller.beginTask(session, "proxy-fallback")!;
    expect(controller.claimInitialRequest(session)).toBe(true);
    expect(controller.claimInitialRequest(session)).toBe(false);

    const secondTask = controller.beginTask(session, "proxy-fallback")!;
    expect(firstTask.isCurrent()).toBe(false);
    expect(firstTask.signal.aborted).toBe(true);
    expect(secondTask.isCurrent()).toBe(true);
  });

  it("does not run scheduled work after session invalidation", () => {
    vi.useFakeTimers();
    const controller = new ViewerSessionController();
    const session = controller.start(first);
    const callback = vi.fn();

    controller.schedule(session, callback, 100);
    controller.invalidate();
    vi.advanceTimersByTime(100);

    expect(callback).not.toHaveBeenCalled();
  });

  it("prevents accidental restart after component disposal", () => {
    const controller = new ViewerSessionController();
    controller.start(first);
    controller.destroy();

    expect(() => controller.start(second)).toThrow(/cannot be restarted/u);
  });
});
