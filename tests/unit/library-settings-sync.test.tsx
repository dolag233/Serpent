// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

import { LibrarySettingsDialog, type SyncSettingsCallbacks } from "../../src/renderer/LibrarySettingsDialog";
import { SyncSettingsPage } from "../../src/renderer/SyncSettingsPage";
import { LocaleProvider } from "../../src/renderer/i18n";
import type { RendererLibrarySummary, SyncProgressEvent } from "../../src/shared/protocol/responses";

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  container?.remove();
  root = undefined;
  container = undefined;
});

test("saving auto sync during a transfer acknowledges locally without probing the busy Worker", async () => {
  const syncProbe = vi.fn(async () => ({
    ok: true as const,
    value: {
      auth: "none" as const,
      supportsContentTransfer: true,
      supportsDepthInfinity: false,
      supportsEtagIfMatch: false,
      supportsMove: false,
      supportsLock: false,
    },
  }));
  const syncSaveBinding = vi.fn(async () => ({ ok: true as const }));
  const callbacks: SyncSettingsCallbacks = {
    syncListServers: async () => ({ ok: true, value: [{ id: "server-1", baseUrl: "https://example.test/dav", hasPassword: false, allowInsecureTls: false }] }),
    syncGetBinding: async () => ({ ok: true, value: { serverId: "server-1", directoryName: "Fixture" } }),
    syncProbe,
    syncPreview: vi.fn(),
    syncRun: vi.fn(),
    syncSaveBinding,
  };
  const library = {
    libraryId: "fixture-library",
    displayName: "Fixture",
    displayPath: "fixture",
  } as RendererLibrarySummary;
  const progress = {
    type: "sync.progress",
    libraryId: library.libraryId,
    phase: "run",
    filesDone: 1,
    filesTotal: 10,
    bytesDone: 10,
    bytesTotal: 100,
  } as SyncProgressEvent;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  const render = async (syncProgress: SyncProgressEvent | null) => {
    await act(async () => {
      root?.render(createElement(LocaleProvider, {
        initialPreference: "zh-CN",
        children: createElement(LibrarySettingsDialog, {
          library,
          open: true,
          gitignoreContent: "",
          onClose: vi.fn(),
          onSaveName: vi.fn(),
          onSaveGitignore: vi.fn(),
          onPreviewGitignore: vi.fn(),
          syncCallbacks: callbacks,
          syncProgress,
          embeddingCallbacks: {} as never,
          embeddingIndex: null,
        }),
      }));
      await Promise.resolve();
    });
  };

  await render(progress);
  await act(async () => {
    container?.querySelector<HTMLButtonElement>("#library-settings-tab-sync")?.click();
    await Promise.resolve();
  });
  expect(syncProbe).not.toHaveBeenCalled();
  expect(container?.textContent).toContain("同步中");

  const save = [...container!.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.trim() === "保存");
  expect(save).toBeDefined();
  await act(async () => {
    save?.click();
    await Promise.resolve();
  });
  expect(syncSaveBinding).toHaveBeenCalledOnce();
  expect(container?.textContent).not.toContain("保存中");
  expect(container?.textContent).not.toContain("连接失败");

  await render(null);
  expect(syncProbe).toHaveBeenCalledOnce();
  expect(container?.textContent).toContain("服务器可访问");
});

test("server settings asks for missing credentials instead of reporting unsupported upload", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      initialPreference: "zh-CN",
      children: createElement(SyncSettingsPage, {
        showCardSyncStatus: true,
        onShowCardSyncStatusChange: vi.fn(),
        callbacks: {
          syncListServers: async () => ({ ok: true as const, value: [{
            id: "server-1", baseUrl: "https://example.test/dav", hasPassword: false, allowInsecureTls: false,
          }] }),
          syncSaveServer: vi.fn(),
          syncDeleteServer: vi.fn(),
          syncProbe: async () => ({ ok: true as const, value: {
            auth: "basic" as const, supportsContentTransfer: false, supportsDepthInfinity: false,
            supportsEtagIfMatch: false, supportsMove: false, supportsLock: false,
          } }),
        },
      }),
    }));
    await Promise.resolve();
  });
  expect(container.textContent).toContain("请先为这台服务器填写用户名和密码");
  expect(container.textContent).not.toContain("服务器未声明支持上传文件");
});
