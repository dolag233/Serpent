import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AboutDialog } from "../../src/renderer/AboutDialog";
import { LocaleProvider } from "../../src/renderer/i18n";

function withChineseLocale(node: ReactElement): ReactElement {
  return createElement(
    LocaleProvider,
    {
      initialPreference: "zh-CN",
      storage: {
        getItem: () => null,
        setItem: () => undefined,
        removeItem: () => undefined,
      },
      children: node,
    },
  );
}

describe("AboutDialog update controls", () => {
  it("shows the available version row and both icon hover labels", () => {
    const html = renderToStaticMarkup(
      withChineseLocale(
        createElement(AboutDialog, {
          open: true,
          version: "0.1.1",
          onClose: () => undefined,
          onOpenGitHub: () => undefined,
          updateCheck: {
            ok: true,
            status: "available",
            currentVersion: "0.1.1",
            latestVersion: "0.1.3",
            distribution: "portable",
            assetKind: "portable",
            assetName: "Serpent-mac-arm64-portable.zip",
            assetSize: 1024,
            releaseNotes: "",
          },
          updateInstall: null,
          updateChecking: false,
          updateInstalling: false,
          onCheckForUpdates: () => undefined,
          onDownloadAndInstall: () => undefined,
        }),
      ),
    );

    expect(html).toContain("可更新到 0.1.3");
    expect(html).toContain('data-hover-tip="检查更新"');
    expect(html).toContain('data-hover-tip="下载更新 0.1.3 版本"');
  });
});
