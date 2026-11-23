// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const renderIcon = vi.hoisted(() => vi.fn());
vi.mock("../../src/renderer/Icons", async () => {
  const { createElement } = await import("react");
  return { Icon: () => { renderIcon(); return createElement("svg"); } };
});
import { NavTreeDisclosure } from "../../src/renderer/nav-tree-disclosure";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  renderIcon.mockClear();
  vi.unstubAllGlobals();
});

it("reuses stable controls during unrelated parent renders", async () => {
  const onToggle = vi.fn();
  const props = { entityId: "folder-alpha", expanded: true, label: "Collapse Alpha", onToggle };
  function Parent({ revision }: { revision: number }) {
    return createElement("div", { "data-revision": revision }, createElement(NavTreeDisclosure, props));
  }
  await act(async () => root.render(createElement(Parent, { revision: 0 })));
  expect(renderIcon).toHaveBeenCalledTimes(1);
  const button = host.querySelector("button");
  await act(async () => root.render(createElement(Parent, { revision: 1 })));
  expect(renderIcon).toHaveBeenCalledTimes(1);
  expect(host.querySelector("button")).toBe(button);
});

it("uses the current entity, callback, expanded state and accessible label without bubbling", async () => {
  const firstToggle = vi.fn();
  const latestToggle = vi.fn();
  const parentClick = vi.fn();
  const render = async (entityId: string, expanded: boolean, label: string, onToggle: (id: string) => void) => {
    await act(async () => root.render(createElement("div", { onClick: parentClick },
      createElement(NavTreeDisclosure, { entityId, expanded, label, onToggle }))));
  };
  await render("folder-alpha", true, "Collapse Alpha", firstToggle);
  expect(host.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector("button")?.classList.contains("is-expanded")).toBe(true);
  await render("folder-alpha", true, "Collapse Alpha", latestToggle);
  await act(async () => host.querySelector("button")!.click());
  expect(latestToggle).toHaveBeenCalledExactlyOnceWith("folder-alpha");
  expect(firstToggle).not.toHaveBeenCalled();
  latestToggle.mockClear();
  await render("collection-beta", false, "Expand Beta", latestToggle);
  const button = host.querySelector("button")!;
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-label")).toBe("Expand Beta");
  expect(button.className).toBe("nav-disclosure");
  expect(button.type).toBe("button");
  await act(async () => button.click());
  expect(latestToggle).toHaveBeenCalledExactlyOnceWith("collection-beta");
  expect(firstToggle).not.toHaveBeenCalled();
  expect(parentClick).not.toHaveBeenCalled();
});
