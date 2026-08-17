// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProxyPlaybackNotice } from "../../src/renderer/ProxyPlaybackNotice";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("ProxyPlaybackNotice", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("can be hidden and restored without losing the explanation", async () => {
    const onHide = vi.fn();
    const onShow = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(ProxyPlaybackNotice, {
            visible: true,
            onHide,
            onShow,
          }),
        ),
      );
    });

    expect(container.textContent).toContain(
      "The original video could not play; the proxy video is playing.",
    );
    const hide = container.querySelector<HTMLButtonElement>("button");
    expect(hide).toBeDefined();
    await act(async () => hide?.click());
    expect(onHide).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(ProxyPlaybackNotice, {
            visible: false,
            onHide,
            onShow,
          }),
        ),
      );
    });
    const restore = container.querySelector<HTMLButtonElement>("button");
    expect(restore?.textContent).toContain("proxy");
    await act(async () => restore?.click());
    expect(onShow).toHaveBeenCalledTimes(1);
  });
});
