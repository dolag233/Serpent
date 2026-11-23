// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIconRender = vi.hoisted(() => vi.fn());

vi.mock("../../src/renderer/Icons", async () => {
  const { createElement: h } = await import("react");
  return {
    Icon: ({ name, size = 16, color }: { name: string; size?: number; color?: string }) => {
      mockIconRender({ name, size, color });
      return h("svg", {
        "data-mock-icon": name,
        width: size,
        height: size,
        style: color ? { color } : undefined,
      });
    },
  };
});

import { AppearanceGlyph } from "../../src/renderer/AppearanceGlyph";
import type { EntityAppearance } from "../../src/shared/entity-appearance";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });

function mountRoot(): void {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
}

async function renderGlyph(props: Parameters<typeof AppearanceGlyph>[0]): Promise<void> {
  await act(async () => {
    root?.render(createElement(AppearanceGlyph, props));
  });
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  mockIconRender.mockClear();
  vi.unstubAllGlobals();
});

describe("AppearanceGlyph memo behavior", () => {
  it("skips its Icon children when a parent rerenders with identical props", async () => {
    mountRoot();
    const appearance: EntityAppearance = { glyphKind: "icon", glyphValue: "heart", colorId: null };
    const props = { appearance, fallback: "folder" as const, linkedBadge: "link" as const };
    function Parent({ revision }: { revision: number }) {
      return createElement(
        "div",
        null,
        createElement("span", null, revision),
        createElement(AppearanceGlyph, props),
      );
    }

    await act(async () => root?.render(createElement(Parent, { revision: 0 })));
    expect(mockIconRender).toHaveBeenCalledTimes(2);
    await act(async () => root?.render(createElement(Parent, { revision: 1 })));

    expect(mockIconRender).toHaveBeenCalledTimes(2);
  });

  it("updates appearance, fallback, color, size, emoji, and linked badge output", async () => {
    mountRoot();
    await renderGlyph({ appearance: null, fallback: "folder", color: "red" });
    let glyph = container!.querySelector<HTMLElement>(".nav-entity-glyph")!;
    let mainIcon = glyph.querySelector<SVGElement>(":scope > svg");
    expect(mainIcon?.getAttribute("data-mock-icon")).toBe("folder");
    expect(mainIcon?.getAttribute("width")).toBe("15");
    expect(glyph.style.color).toBe("red");

    await renderGlyph({ appearance: null, fallback: "star", size: 22, color: "blue" });
    glyph = container!.querySelector<HTMLElement>(".nav-entity-glyph")!;
    mainIcon = glyph.querySelector<SVGElement>(":scope > svg");
    expect(mainIcon?.getAttribute("data-mock-icon")).toBe("star");
    expect(mainIcon?.getAttribute("width")).toBe("22");
    expect(glyph.style.color).toBe("blue");

    const heart: EntityAppearance = { glyphKind: "icon", glyphValue: "heart", colorId: "red" };
    await renderGlyph({ appearance: heart, fallback: "folder", size: 24, color: "blue", linkedBadge: "link" });
    glyph = container!.querySelector<HTMLElement>(".nav-entity-glyph")!;
    mainIcon = glyph.querySelector<SVGElement>(":scope > svg");
    expect(mainIcon?.getAttribute("data-mock-icon")).toBe("heart");
    expect(mainIcon?.getAttribute("width")).toBe("24");
    expect(glyph.style.color).toBe("var(--appearance-color-red)");
    expect(glyph.querySelector(".nav-entity-glyph-badge [data-mock-icon='link']")).not.toBeNull();

    const palette: EntityAppearance = { glyphKind: "icon", glyphValue: "palette", colorId: "teal" };
    await renderGlyph({ appearance: palette, fallback: "folder", size: 20, linkedBadge: "link-off" });
    glyph = container!.querySelector<HTMLElement>(".nav-entity-glyph")!;
    mainIcon = glyph.querySelector<SVGElement>(":scope > svg");
    expect(mainIcon?.getAttribute("data-mock-icon")).toBe("palette");
    expect(mainIcon?.getAttribute("width")).toBe("20");
    expect(glyph.style.color).toBe("var(--appearance-color-teal)");
    expect(glyph.querySelector(".nav-entity-glyph-badge [data-mock-icon='link-off']")).not.toBeNull();

    const emoji: EntityAppearance = { glyphKind: "emoji", glyphValue: "🙂", colorId: null };
    await renderGlyph({ appearance: emoji, fallback: "folder", size: 20, linkedBadge: "link" });
    glyph = container!.querySelector<HTMLElement>(".nav-entity-glyph")!;
    expect(glyph.querySelector(".nav-entity-glyph-emoji")?.textContent).toBe("🙂");
    expect((glyph.querySelector<HTMLElement>(".nav-entity-glyph-emoji")?.style.fontSize)).toBe("19px");

    const otherEmoji: EntityAppearance = { glyphKind: "emoji", glyphValue: "🎨", colorId: null };
    await renderGlyph({ appearance: otherEmoji, fallback: "folder", size: 22, linkedBadge: null });
    glyph = container!.querySelector<HTMLElement>(".nav-entity-glyph")!;
    expect(glyph.querySelector(".nav-entity-glyph-emoji")?.textContent).toBe("🎨");
    expect(glyph.querySelector<HTMLElement>(".nav-entity-glyph-emoji")?.style.fontSize).toBe("21px");
    expect(glyph.querySelector(".nav-entity-glyph-badge")).toBeNull();
  });
});
