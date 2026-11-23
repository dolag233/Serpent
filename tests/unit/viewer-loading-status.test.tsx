// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ViewerLoadingStatus } from "../../src/renderer/viewer-loading-status";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function displayStatus(assetId: string) {
  act(() => root.render(<ViewerLoadingStatus key={assetId} label="Loading…" />));
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

it("announces loading at one second and clears the timer on early completion", () => {
  displayStatus("first");
  advance(999);
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  advance(1);
  expect(container.firstElementChild?.hasAttribute("aria-hidden")).toBe(false);

  displayStatus("second");
  act(() => root.render(null));
  expect(vi.getTimerCount()).toBe(0);
  expect(container.firstElementChild).toBeNull();
});

it("restarts the delay when another asset is requested during loading", () => {
  displayStatus("first");
  advance(800);
  displayStatus("second");
  advance(999);
  expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  advance(1);
  expect(container.firstElementChild?.hasAttribute("aria-hidden")).toBe(false);
});
