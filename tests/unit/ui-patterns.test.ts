// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  getDialogFocusBoundary,
  getTopmostDialog,
  type DialogStackEntry,
} from "../../src/renderer/ui/patterns/dialog";
import {
  resolveMenuNodes,
  type MenuNode,
} from "../../src/renderer/ui/patterns/menu";

describe("UI patterns: modal focus boundary", () => {
  it("selects the last open dialog in stack order", () => {
    const entries: readonly DialogStackEntry[] = [
      { id: "base", open: true },
      { id: "closed", open: false },
      { id: "topmost", open: true },
    ];

    expect(getTopmostDialog(entries)?.id).toBe("topmost");
  });

  it("returns the first and last focusable descendants without moving focus", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <button id="first">First</button>
        <input id="middle" disabled />
        <a id="last" href="#last">Last</a>
      </section>
    `;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    const boundary = getDialogFocusBoundary(dialog);
    expect(boundary?.root).toBe(dialog);
    expect(boundary?.firstFocusable?.id).toBe("first");
    expect(boundary?.lastFocusable?.id).toBe("last");
  });
});

describe("UI patterns: resolved menu tree", () => {
  it("propagates hidden state through descendants and removes empty submenus", () => {
    const nodes: MenuNode[] = [
      {
        kind: "submenu",
        id: "hidden-parent",
        label: "Hidden parent",
        when: false,
        children: [{ kind: "item", id: "child", label: "Child", command: "child.run" }],
      },
      {
        kind: "submenu",
        id: "empty-parent",
        label: "Empty parent",
        children: [{
          kind: "item",
          id: "hidden-child",
          label: "Hidden",
          command: "hidden.run",
          hidden: true,
        }],
      },
      {
        kind: "submenu",
        id: "visible-parent",
        label: "Visible parent",
        children: [
          {
            kind: "submenu",
            id: "nested",
            label: "Nested",
            children: [{ kind: "item", id: "leaf", label: "Leaf", command: "leaf.run" }],
          },
        ],
      },
    ];

    const resolved = resolveMenuNodes(nodes);
    expect(resolved.map((node) => node.id)).toEqual(["visible-parent"]);
    expect(resolved[0]).toMatchObject({ kind: "submenu", id: "visible-parent" });
    if (resolved[0]?.kind === "submenu") {
      expect(resolved[0].children[0]).toMatchObject({ kind: "submenu", id: "nested" });
    }
  });

  it("freezes evaluated enablement and checked results in a copied tree", () => {
    const mutableItem = {
      kind: "item" as const,
      id: "toggle",
      label: "Toggle",
      command: "toggle.run",
      enablement: false,
      checked: true,
    };
    const item: MenuNode = mutableItem;

    const resolved = resolveMenuNodes([item]);
    expect(resolved[0]).toMatchObject({ enabled: false, checked: true });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved[0])).toBe(true);

    mutableItem.enablement = true;
    mutableItem.checked = false;
    expect(resolved[0]).toMatchObject({ enabled: false, checked: true });
  });
});
