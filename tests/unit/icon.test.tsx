// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Icon } from "../../src/renderer/Icons";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

async function renderIcon(props: Parameters<typeof Icon>[0]): Promise<void> {
  await act(async () => {
    root?.render(createElement(Icon, props));
  });
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  vi.unstubAllGlobals();
});

describe("Icon rendering", () => {
  it("keeps SVG paths and applies name, size, and color updates", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await renderIcon({ name: "heart", size: 20, color: "red" });
    let svg = container.querySelector<SVGSVGElement>("svg.icon")!;
    const heartPath = svg.querySelector("path")?.getAttribute("d");
    expect(heartPath).toBeTruthy();
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("height")).toBe("20");
    expect(svg.style.color).toBe("red");

    await renderIcon({ name: "folder", size: 13, color: "blue" });
    svg = container.querySelector<SVGSVGElement>("svg.icon")!;
    const folderPath = svg.querySelector("path")?.getAttribute("d");
    expect(folderPath).toBeTruthy();
    expect(folderPath).not.toBe(heartPath);
    expect(svg.getAttribute("width")).toBe("13");
    expect(svg.getAttribute("height")).toBe("13");
    expect(svg.style.color).toBe("blue");

    await renderIcon({ name: "folder" });
    svg = container.querySelector<SVGSVGElement>("svg.icon")!;
    expect(svg.getAttribute("width")).toBe("16");
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.style.color).toBe("");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(folderPath);
  });
});
