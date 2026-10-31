// @vitest-environment happy-dom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useBrowserSessionViewport } from "../../src/renderer/use-browser-session-restore";
import { readBrowserSession, writeBrowserSession } from "../../src/renderer/browser-session";
import type { WorkspaceNavViewport } from "../../src/renderer/workspace-nav-history";

afterEach(() => { localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it("saves scrolling and restores it without overwriting the saved position during startup", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  writeBrowserSession("lib", { version: 1, scope: { kind: "folder", id: "f" }, selectedAssetId: "", selectedAssetName: "",
    viewport: { scrollTop: 500, scrollExtent: 1000, scrollProgress: 0.5 } });
  const canvas = document.createElement("div");
  Object.defineProperties(canvas, { scrollHeight: { value: 1200 }, clientHeight: { value: 200 } });
  canvas.scrollTo = (options) => { if (typeof options === "object") canvas.scrollTop = options.top ?? 0; };
  const host = document.createElement("div");
  document.body.append(host, canvas);
  function Harness() {
    const canvasRef = useRef<HTMLElement | null>(canvas);
    const pending = useRef<WorkspaceNavViewport | null>({ scrollTop: 500, scrollExtent: 1000, scrollProgress: 0.5 });
    useBrowserSessionViewport({ libraryId: "lib", ready: true, canvasRef, pendingRef: pending });
    return null;
  }
  const root = createRoot(host);
  await act(async () => { root.render(createElement(Harness)); });
  canvas.dispatchEvent(new Event("scroll"));
  expect(readBrowserSession("lib")?.viewport?.scrollTop).toBe(500);
  await act(async () => { vi.advanceTimersByTime(300); });
  expect(canvas.scrollTop).toBe(500);
  canvas.scrollTop = 750;
  await act(async () => { canvas.dispatchEvent(new Event("scroll")); vi.advanceTimersByTime(250); });
  expect(readBrowserSession("lib")?.viewport).toEqual({ scrollTop: 750, scrollExtent: 1000, scrollProgress: 0.75 });
  await act(async () => { root.unmount(); });
});
