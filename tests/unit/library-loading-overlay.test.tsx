// @vitest-environment happy-dom
import {
  act,
  createElement,
  type ComponentProps,
  type ReactElement,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibraryLoadingOverlay } from "../../src/renderer/LibraryLoadingOverlay";
import { LocaleProvider } from "../../src/renderer/i18n";

function overlay(
  props: Partial<ComponentProps<typeof LibraryLoadingOverlay>> = {},
): ReactElement {
  return createElement(
    LocaleProvider,
    {
      initialPreference: "zh-CN",
      children: createElement(LibraryLoadingOverlay, {
        name: "示例资源库",
        ...props,
      }),
    },
  );
}

describe("LibraryLoadingOverlay", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  async function renderOverlay(
    props: Partial<ComponentProps<typeof LibraryLoadingOverlay>> = {},
  ) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(overlay(props));
    });
  }

  it("identifies the target library and keeps the workspace covered", () => {
    const html = renderToStaticMarkup(overlay());

    expect(html).toContain("正在打开“示例资源库”资源库");
    expect(html).toContain("切换资源库");
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("进度");
    expect(html).not.toContain("Serpent 正在");
  });

  it("lets the user choose another library without dismissing the load", async () => {
    const onSwitchLibrary = vi.fn();
    await renderOverlay({ onSwitchLibrary });

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('button[type="button"]')
        ?.click();
    });

    expect(onSwitchLibrary).toHaveBeenCalledOnce();
    expect(container?.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("reuses the quiet delayed surface for a slow library deletion", () => {
    const html = renderToStaticMarkup(
      overlay({ operation: "deleting", onSwitchLibrary: undefined }),
    );

    expect(html).toContain("正在删除“示例资源库”资源库");
    expect(html).toContain('role="progressbar"');
    expect(html).not.toContain("切换资源库");
    expect(html).not.toContain("Serpent 正在");
  });
});
