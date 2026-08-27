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
            releaseMeta: {
              version: "0.1.3",
              date: "2026-08-28",
              changelog: [{ zhCN: "修复资源库打开稳定性。", en: "Improve library-open stability." }],
              mandatory: false,
            },
          },
          updateInstall: null,
          updateChecking: false,
          updateInstalling: false,
          updateProgress: null,
          onCheckForUpdates: () => undefined,
          onDownloadAndInstall: () => undefined,
          onCancelDownload: () => undefined,
          onOpenReleaseNotes: () => undefined,
        }),
      ),
    );

    expect(html).toContain("可更新到 0.1.3");
    expect(html).toContain('data-hover-tip="检查更新"');
    expect(html).toContain('data-hover-tip="下载更新 0.1.3 版本"');
    expect(html).toContain("查看更新日志");
  });

  it("shows download progress and a stop button while installing", () => {
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
            distribution: "installed",
            assetKind: "installer",
            assetName: "Serpent-win-x86-64-0.1.3-setup.zip",
            assetSize: 2048,
            releaseNotes: "",
          },
          updateInstall: null,
          updateChecking: false,
          updateInstalling: true,
          updateProgress: {
            phase: "downloading",
            downloadedBytes: 1024,
            totalBytes: 2048,
          },
          onCheckForUpdates: () => undefined,
          onDownloadAndInstall: () => undefined,
          onCancelDownload: () => undefined,
        }),
      ),
    );

    expect(html).toContain('role="progressbar"');
    expect(html).toContain('data-hover-tip="停止下载"');
    expect(html).toContain('about-dialog-update-stop');
    expect(html).not.toContain(">停止下载<");
    expect(html).toContain("已下载");
  });

  it("does not offer cancellation after extraction has started", () => {
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
            distribution: "installed",
            assetKind: "installer",
            assetName: "Serpent-win-x86-64-0.1.3-setup.zip",
            assetSize: 2048,
            releaseNotes: "",
          },
          updateInstall: null,
          updateChecking: false,
          updateInstalling: true,
          updateProgress: {
            phase: "extracting",
            downloadedBytes: 2048,
            totalBytes: 2048,
          },
          onCheckForUpdates: () => undefined,
          onDownloadAndInstall: () => undefined,
          onCancelDownload: () => undefined,
        }),
      ),
    );

    expect(html).not.toContain('data-hover-tip="停止下载"');
    expect(html).not.toContain('about-dialog-update-stop');
  });
});
