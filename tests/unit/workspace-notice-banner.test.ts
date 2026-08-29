import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceNoticeBanner } from "../../src/renderer/WorkspaceNoticeBanner";
import { LocaleProvider } from "../../src/renderer/i18n";

describe("WorkspaceNoticeBanner diagnostics", () => {
  it("exposes the complete notice text through the standard hover tip", () => {
    const fullMessage = "删除链接资产未全部完成：已删除 0 项，另有 1 项保留。原因：源文件已被移动到其他位置";
    const html = renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { initialPreference: "zh-CN", children: createElement(WorkspaceNoticeBanner, {
          message: { kind: "error", text: fullMessage },
          toastId: 1,
          closing: false,
          onDismiss: () => undefined,
          onTransitionEnd: () => undefined,
        }) },
      ),
    );

    expect(html).toContain(`data-hover-tip="${fullMessage}"`);
  });
});
