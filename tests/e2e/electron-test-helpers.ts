import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import type { Locator, Page } from '@playwright/test';

const require = createRequire(path.resolve('package.json'));

/**
 * Serpent-wgmy: 日志按会话拆分（serpent-<时间戳>.log）。返回 logs 目录下
 * 最新的会话日志路径（mtime 优先，同名则按名称降序）；目录为空时返回
 * 固定的 serpent.log 占位（调用方按不存在处理）。
 */
export function resolveSessionLogPath(logsPath: string): string {
  const entries = readdirSync(logsPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('serpent-') &&
        entry.name.endsWith('.log'),
    )
    .map((entry) => path.join(logsPath, entry.name))
    .sort((a, b) => {
      const aStat = require('node:fs').statSync(a);
      const bStat = require('node:fs').statSync(b);
      return bStat.mtimeMs - aStat.mtimeMs || b.localeCompare(a);
    });
  return entries[0] ?? path.join(logsPath, 'serpent.log');
}

export function resolveElectronExecutablePath(): string {
  const override = process.env.SERPENT_E2E_ELECTRON_EXECUTABLE;
  if (override) return override;

  const executablePath: unknown = require('electron');
  if (typeof executablePath !== 'string') {
    throw new TypeError('The local electron package did not resolve to an executable path.');
  }

  return executablePath;
}

/** Locate a browse card by its stable filename title, independent of caption formatting. */
export function assetCard(window: Page, displayName: string): Locator {
  const escaped = displayName.replaceAll('"', '\\"');
  return window.locator(`.asset-card[title="${escaped}"]`);
}

/** Run the E2E-selected file import through the typed preload contract. */
export async function importFilesThroughBridge(
  window: Page,
  targetFolderName?: string,
): Promise<void> {
  await window.evaluate(async (folderName) => {
    interface Result<T> {
      ok: boolean;
      value?: T;
      error?: { code: string; message?: string };
    }
    type Folder = { folderId: string; name: string };
    type LibraryApi = {
      listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
      listFolders(input: { libraryId: string }): Promise<Result<Folder[]>>;
      importFiles(input: {
        libraryId: string;
        targetFolderId?: string;
      }): Promise<Result<{ assets: unknown[] }>>;
    };
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: LibraryApi };
    };
    const opened = await bridge.serpent.library.listOpen();
    const libraryId = opened.value?.[0]?.libraryId;
    if (!opened.ok || !libraryId) throw new Error('Expected an open library.');
    const folders = await bridge.serpent.library.listFolders({ libraryId });
    if (!folders.ok) throw new Error('Could not list folders.');
    const targetFolderId = folderName === undefined
      ? undefined
      : folders.value?.find((folder) => folder.name === folderName)?.folderId;
    if (folderName !== undefined && !targetFolderId) {
      throw new Error(`Expected folder ${folderName}.`);
    }
    const imported = await bridge.serpent.library.importFiles({
      libraryId,
      ...(targetFolderId ? { targetFolderId } : {}),
    });
    if (!imported.ok || !imported.value) {
      throw new Error(imported.error?.message ?? 'Could not import files.');
    }
  }, targetFolderName);
  // A direct preload call bypasses the renderer's import-reveal refresh. The
  // normal refresh command makes the helper observe the same complete browse
  // scope that a user sees after the import dialog closes.
  await window.getByRole('button', { name: '刷新磁盘变化' }).click();
}

/**
 * Environment for `_electron.launch`. Must omit ELECTRON_RUN_AS_NODE — when set,
 * Electron acts as Node and rejects Playwright's --remote-debugging-port.
 * Only string values are kept: undefined env entries can break Electron/Playwright.
 */
export function electronLaunchEnv(
  extra: NodeJS.ProcessEnv = {},
): Record<string, string> {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...clean } = process.env;
  void _ignored;
  const merged: NodeJS.ProcessEnv = { ...clean, ...extra };
  return Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** Close via top-left library switcher (Inspector no longer exposes close/path). */
export async function closeLibraryViaSwitcher(
  window: Page,
  libraryName: string,
): Promise<void> {
  const switcher = window.getByRole('button', {
    name: `当前资源库 ${libraryName}`,
  });
  await switcher.click();
  await window.getByRole('menuitem', { name: '关闭资源库' }).click();
  // A Playwright click resolves after the event handler is dispatched, not
  // after the async Worker close has committed. Waiting for the switcher to
  // disappear makes callers observe the completed library lifecycle instead
  // of racing operation-directory cleanup.
  await switcher.waitFor({ state: 'hidden' });
}
