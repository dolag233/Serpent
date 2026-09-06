// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DeleteProgressOverlay } from "../../src/renderer/DeleteProgressOverlay";
import { LocaleProvider } from "../../src/renderer/i18n";

function overlay(): ReactElement {
  return createElement(LocaleProvider, {
    initialPreference: "zh-CN",
    children: createElement(DeleteProgressOverlay, {
      onCancel: vi.fn(),
      progress: {
        type: "delete.progress",
        operationId: "delete-1",
        libraryId: "library-1",
        kind: "disk",
        phase: "run",
        cancelable: true,
        filesProcessed: 4,
        totalFiles: 12,
      },
    }),
  });
}

describe("DeleteProgressOverlay", () => {
  it("reuses the shared blocking progress chrome with counted disk-delete progress", () => {
    const html = renderToStaticMarkup(overlay());
    expect(html).toContain('data-delete-progress-overlay="true"');
    expect(html).toContain("dialog-backdrop");
    expect(html).toContain("blocking-progress-dialog");
    expect(html).toContain("正在删除");
    expect(html).toContain("4");
    expect(html).toContain("12");
    expect(html).toContain("取消删除");
  });
});
