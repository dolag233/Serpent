// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { createElement, type ReactElement } from "react";

import {
  DialogShell,
  getDialogDefaultAction,
  getDialogFocusBoundary,
  getTopmostDialog,
  shouldActivateDialogDefaultAction,
  type DialogStackEntry,
} from "../../src/renderer/ui/patterns/dialog";
import {
  resolveMenuNodes,
  type MenuNode,
} from "../../src/renderer/ui/patterns/menu";
import { renderToStaticMarkup } from 'react-dom/server';
import { PopoverSurface, SettingsCard } from '../../src/renderer/ui/patterns';

describe("UI patterns: modal focus boundary", () => {
  it("only the topmost dialog consumes Escape", () => {
    let closeCount = 0;
    let prevented = false;
    let stopped = false;
    const topmost = DialogShell({
      children: null,
      dialogId: "topmost",
      onRequestClose: () => { closeCount += 1; },
    }) as ReactElement<{ onKeyDown?: (event: unknown) => void }>;
    topmost.props.onKeyDown?.({
      key: "Escape",
      nativeEvent: {},
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
    });
    expect(closeCount).toBe(1);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);

    const background = DialogShell({
      children: null,
      dialogId: "background",
      isTopmost: false,
      onRequestClose: () => { closeCount += 1; },
    }) as ReactElement<{ onKeyDown?: (event: unknown) => void }>;
    background.props.onKeyDown?.({
      key: "Escape",
      nativeEvent: {},
      preventDefault: () => undefined,
      stopPropagation: () => undefined,
    });
    expect(closeCount).toBe(1);
  });

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

  it("resolves an enabled explicit or primary default action", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <button class="primary-button" disabled>Disabled</button>
        <button data-dialog-default-action="true" id="default">Default</button>
        <button class="primary-button" id="primary">Primary</button>
      </section>
    `;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');

    expect(getDialogDefaultAction(dialog)?.id).toBe("default");
  });

  it("keeps Enter available for text fields but leaves native controls alone", () => {
    document.body.innerHTML = `
      <section role="dialog" aria-modal="true">
        <input id="text" />
        <textarea id="multiline"></textarea>
        <select id="select"><option>one</option></select>
        <input id="checkbox" type="checkbox" />
        <button id="button">Button</button>
      </section>
    `;

    expect(shouldActivateDialogDefaultAction(document.querySelector("#text"))).toBe(true);
    expect(shouldActivateDialogDefaultAction(document.querySelector("#multiline"))).toBe(false);
    expect(shouldActivateDialogDefaultAction(document.querySelector("#select"))).toBe(true);
    expect(shouldActivateDialogDefaultAction(document.querySelector("#checkbox"))).toBe(false);
    expect(shouldActivateDialogDefaultAction(document.querySelector("#button"))).toBe(false);
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

describe('UI patterns: shared surfaces', () => {
  it('exposes semantic popover layer and role', () => {
    const html = renderToStaticMarkup(createElement(PopoverSurface, { role: 'listbox', title: 'Choose' }, 'Items'));
    expect(html).toContain('data-ui-pattern="popover-surface"');
    expect(html).toContain('data-ui-layer="400"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('Choose');
  });

  it('keeps settings cards on one shared surface contract', () => {
    const html = renderToStaticMarkup(createElement(SettingsCard, { title: 'Appearance' }, 'Fields'));
    expect(html).toContain('data-ui-pattern="settings-card"');
    expect(html).toContain('ui-settings-card');
    expect(html).toContain('Appearance');
  });
});
