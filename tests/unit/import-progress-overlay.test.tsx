// @vitest-environment happy-dom
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ImportProgressOverlay } from "../../src/renderer/ImportProgressOverlay";
import { LocaleProvider } from "../../src/renderer/i18n";

function overlay(): ReactElement {
  return createElement(LocaleProvider, {
    initialPreference: "zh-CN",
    children: createElement(ImportProgressOverlay, {
      transferKind: "import",
      transferName: "",
      onCancel: vi.fn(),
      progress: {
        type: "import.progress",
        importId: "import-1",
        phase: "copy",
        cancelable: true,
        filesProcessed: 2,
        totalFiles: 8,
        bytesProcessed: 1024,
        totalBytes: 8192,
      },
    }),
  });
}

describe("ImportProgressOverlay", () => {
  it("covers the workspace with counted import progress and a cancel action", () => {
    const html = renderToStaticMarkup(overlay());
    expect(html).toContain('data-import-progress-overlay="true"');
    expect(html).toContain("dialog-backdrop");
    expect(html).toContain("blocking-progress-dialog");
    expect(html).toContain("正在导入");
    expect(html).toContain("2/8");
    expect(html).toContain("取消导入");
    expect(html).not.toContain("安全");
    expect(html).not.toContain("登记");
  });
});
