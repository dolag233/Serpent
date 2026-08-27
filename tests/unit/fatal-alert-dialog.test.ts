// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FatalAlertDialog } from "../../src/renderer/FatalAlertDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("FatalAlertDialog library recovery action", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("offers a direct switch-library action after a failed operation", async () => {
    const onSwitchLibrary = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(FatalAlertDialog, {
            message: "无法打开资源库",
            onDismiss: vi.fn(),
            onSwitchLibrary,
          }),
        ),
      );
    });

    const switchButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "切换资源库",
    );
    expect(switchButton).toBeDefined();
    await act(async () => {
      switchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSwitchLibrary).toHaveBeenCalledTimes(1);
  });
});
