// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TagManagementWorkspace,
  type TagManagementWorkspaceProps,
} from "../../src/renderer/TagManagementWorkspace";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("TagManagementWorkspace create flow", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
    vi.restoreAllMocks();
  });

  it("does not clear a newer draft when an earlier create finishes", async () => {
    let resolveFirstCreate: ((result: boolean) => void) | undefined;
    const onCreate = vi.fn((name: string) => {
      if (name === "beta") {
        return new Promise<boolean>((resolve) => {
          resolveFirstCreate = resolve;
        });
      }
      return Promise.resolve(true);
    });
    const props: TagManagementWorkspaceProps = {
      busy: false,
      onCreate,
      onDeleteMany: async () => true,
      onMerge: async () => true,
      onOpenTag: () => undefined,
      onRename: async () => true,
      onSearchTags: () => undefined,
      tags: [],
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          LocaleProvider,
          null,
          createElement(TagManagementWorkspace, props),
        ),
      );
    });

    const input = container.querySelector<HTMLInputElement>(
      ".tag-management-create input",
    );
    const button = container.querySelector<HTMLButtonElement>(
      ".tag-management-create button",
    );
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();

    const setDraft = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, value);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    await setDraft("beta");
    await act(async () => {
      button?.click();
    });
    expect(onCreate).toHaveBeenNthCalledWith(1, "beta");

    await setDraft("alpha");
    resolveFirstCreate?.(true);
    await act(async () => undefined);

    expect(button?.disabled).toBe(false);
    await act(async () => {
      button?.click();
    });
    expect(onCreate).toHaveBeenNthCalledWith(2, "alpha");
  });
});
