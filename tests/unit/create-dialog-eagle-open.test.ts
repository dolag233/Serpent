// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CreateDialog } from "../../src/renderer/CreateDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("CreateDialog Eagle open name panel", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  });

  it("reuses the create-library name form after a validated Eagle source", async () => {
    const onSubmit = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(CreateDialog, {
            busy: false,
            open: true,
            phase: "eagle",
            required: false,
            value: "Reference",
            onValueChange: vi.fn(),
            onBeginCreate: vi.fn(),
            onBackToStart: vi.fn(),
            onSubmit,
            onCancel: vi.fn(),
            onOpenExisting: vi.fn(),
            onImportLibrary: vi.fn(),
            onOpenRecent: vi.fn(),
          }),
        ),
      );
    });

    const title = container.querySelector("#create-library-dialog-title");
    expect(title?.textContent).toMatch(/打开 Eagle 资源库|Open Eagle library/);
    expect(container.querySelector("#dialog-name")).toHaveProperty(
      "value",
      "Reference",
    );
    const submit = container.querySelector<HTMLButtonElement>(
      "button.primary-button[type='submit']",
    );
    expect(submit?.textContent).toMatch(/选择保存位置|Choose save location/);
    expect(container.querySelector(".create-dialog-recent-list")).toBeNull();

    await act(async () => {
      submit?.click();
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
