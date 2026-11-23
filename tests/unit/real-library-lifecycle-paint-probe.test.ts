// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { Page } from "@playwright/test";
import { installLibraryLifecyclePaintProbe } from "../e2e/real-library-lifecycle-paint-probe";

type FakeEvaluateFunction = (arg?: unknown) => unknown | Promise<unknown>;

function fakePage(): Page {
  const evaluate = async (pageFunction: FakeEvaluateFunction, arg?: unknown) => pageFunction(arg);
  return { evaluate } as unknown as Page;
}

function controlledRaf() {
  const callbacks = new Map<number, FrameRequestCallback>();
  const originalRequest = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  let nextId = 0;
  let requestCount = 0;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    requestCount += 1;
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    callbacks.delete(id);
  }) as typeof window.cancelAnimationFrame;
  return {
    callbacks,
    get requestCount() { return requestCount; },
    flush() {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(performance.now());
    },
    restore() {
      window.requestAnimationFrame = originalRequest;
      window.cancelAnimationFrame = originalCancel;
    },
  };
}

function installViewportRect(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, width, height),
  });
}

function appendImageCard(canvas: HTMLElement, assetId: string): HTMLImageElement {
  const card = document.createElement("button");
  card.className = "asset-card";
  card.dataset.assetId = assetId;
  card.dataset.mediaType = "image";
  installViewportRect(card, 180, 180);
  const image = document.createElement("img");
  image.className = "asset-thumbnail";
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    naturalWidth: { configurable: true, value: 64 },
    naturalHeight: { configurable: true, value: 64 },
  });
  card.append(image);
  canvas.append(card);
  return image;
}

describe("real library lifecycle paint probe", () => {
  it("fences stale library images, coalesces DOM/load events, and cleans up listeners and RAF", async () => {
    document.body.replaceChildren();
    const trigger = document.createElement("button");
    trigger.className = "library-switcher-trigger";
    const name = document.createElement("span");
    name.className = "library-switcher-name";
    name.textContent = "SyntheticControl";
    trigger.append(name);
    document.body.append(trigger);

    const canvas = document.createElement("main");
    canvas.className = "workspace-canvas";
    installViewportRect(canvas, 600, 400);
    document.body.append(canvas);
    const staleImage = appendImageCard(canvas, "synthetic-control-asset");
    const raf = controlledRaf();
    let probe: Awaited<ReturnType<typeof installLibraryLifecyclePaintProbe>> | undefined;
    try {
      probe = await installLibraryLifecyclePaintProbe(fakePage());
      await probe.start({
        targetLibraryName: "SyntheticAlpha",
        expectedAssetIds: ["synthetic-alpha-asset"],
      });
      expect((await probe.read()).targetIdentityReady).toBe(false);

      staleImage.dispatchEvent(new Event("error"));
      expect(raf.callbacks.size).toBe(1);
      raf.flush();
      const whileControlIsOpen = await probe.read();
      expect(whileControlIsOpen.targetIdentityReady).toBe(false);
      expect(whileControlIsOpen.targetCardObserved).toBe(false);
      expect(whileControlIsOpen.firstDecodedObserved).toBe(false);

      name.textContent = "SyntheticAlpha";
      staleImage.parentElement?.remove();
      const alphaImage = appendImageCard(canvas, "synthetic-alpha-asset");
      alphaImage.dispatchEvent(new Event("load"));
      expect(raf.callbacks.size).toBe(1);
      await Promise.resolve();
      expect(raf.callbacks.size).toBe(1);
      await probe.markActionCompleted();
      raf.flush();

      const stopped = await probe.stop();
      expect(stopped).toMatchObject({
        measurement: "DOM-ready-and-decoded-on-RAF",
        status: "observed",
        targetIdentityReady: true,
        targetCardObserved: true,
        firstDecodedObserved: true,
        ninetyPercentDecodedObserved: true,
        visibleTargetCards: 1,
        visibleImageCards: 1,
        unexpectedVisibleImageCards: 0,
        decodedImages: 1,
        coverage: 1,
      });
      expect(stopped.identityReadyMs).not.toBeNull();
      expect(stopped.firstTargetCardMs).not.toBeNull();
      expect(stopped.firstDecodedMs).not.toBeNull();
      expect(stopped.ninetyPercentDecodedMs).not.toBeNull();
      expect(stopped.actionCompletedMs).not.toBeNull();
      expect(stopped.sampleCount).toBe(3);
      const serialized = JSON.stringify(stopped);
      expect(serialized).not.toContain("synthetic-alpha-asset");
      expect(serialized).not.toContain("synthetic-control-asset");
      expect(serialized).not.toContain("SyntheticAlpha");

      const requestsBeforePostStopMutation = raf.requestCount;
      name.textContent = "SyntheticControl";
      appendImageCard(canvas, "synthetic-after-stop");
      alphaImage.dispatchEvent(new Event("load"));
      await Promise.resolve();
      expect(raf.callbacks.size).toBe(0);
      expect(raf.requestCount).toBe(requestsBeforePostStopMutation);
    } finally {
      await probe?.stop().catch(() => undefined);
      raf.restore();
      document.body.replaceChildren();
    }
  });
});
