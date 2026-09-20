// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiConnectionFailureDialog } from "../../src/renderer/AiConnectionFailureDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("AiConnectionFailureDialog (Serpent-c7d64e)", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("reuses the blocking alert surface and rate-limit copy, without a DialogShell header rule", async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          { children: null, initialPreference: "zh-CN" },
          createElement(AiConnectionFailureDialog, {
            failedCount: 23,
            failureCode: "AI_RATE_LIMIT",
            open: true,
            onAbort: vi.fn(),
            onRetry: vi.fn(),
          }),
        ),
      );
    });

    const dialog = container.querySelector(".create-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector("[data-dialog-header]")).toBeNull();
    expect(dialog?.classList.contains("ui-dialog-shell")).toBe(false);
    expect(dialog?.textContent).toContain("请求过于频繁");
    expect(dialog?.textContent).not.toContain("无法连接 AI 供应商");
    expect(container.querySelectorAll(".dialog-actions").length).toBe(1);
  });
});
