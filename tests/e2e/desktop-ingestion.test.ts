import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

/**
 * Locates a managed folder's sidebar nav row by its label text. Folder cards
 * only render in a managed-folder/root view (not the default "所有资产" scope
 * — FOLDER-010), so create-and-enter goes through the sidebar. The nav label
 * ellipsis-truncates in narrow panes (clipping its text node and breaking an
 * accessible-name match), hence label text + ancestor row.
 */
function sidebarFolderRow(window: Page, folderName: string) {
  return window
    .locator('.navigation-pane .nav-row-label', { hasText: folderName })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

test('pastes a Main-owned clipboard image into the current folder and collection', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-desktop-ingestion-e2e-'));
  const clipboardSource = path.join(temporaryRoot, 'clipboard.png');
  // Valid 1x1 transparent PNG. Main decodes it as a native image and writes a
  // fresh app-owned staging PNG before invoking the normal Worker import flow.
  writeFileSync(clipboardSource, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  ));
  const libraryName = '桌面导入验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_CLIPBOARD_IMAGE_PATH: clipboardSource,
      SERPENT_E2E_CLIPBOARD_NOW: '2026-07-13T12:34:56.000Z',
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '添加文件夹' }).click();
    await window.getByLabel("新文件夹名称").fill('项目');
    await window.keyboard.press("Enter");
    await sidebarFolderRow(window, '项目').click();

    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('新建合集').fill('情绪板');
    await window.getByPlaceholder('新建合集').press('Enter');
    await window.getByRole('button', { name: '情绪板' }).click();

    const firstPaste = await pasteClipboardImage(window, '项目', '情绪板');
    expect(firstPaste.ok).toBe(true);
    // The pasted filename also appears in the Inspector hero title, so scope to
    // the canvas asset card to avoid a strict-mode violation.
    await expect(
      window.locator('.asset-card', { hasText: 'Clipboard 2026-07-13T12-34-56Z.png' }),
    ).toBeVisible();

    const projectDirectory = path.join(libraryPath, 'Assets', '项目');
    const importedNames = readdirSync(projectDirectory).filter((name) => /^Clipboard .*\.png$/.test(name));
    expect(importedNames).toHaveLength(1);
    expect(existsSync(path.join(projectDirectory, importedNames[0]!))).toBe(true);

    // A second paste deterministically enters the existing conflict flow. The
    // pending opaque import keeps its collection destination until resolution.
    const secondPaste = await pasteClipboardImage(window, '项目', '情绪板');
    expect(secondPaste.ok).toBe(true);
    if (secondPaste.value?.importId) {
      const resolved = await resolveClipboardConflict(window, secondPaste.value.importId);
      expect(resolved).toBe(true);
    }
    await expect(window.locator('.asset-card')).toHaveCount(2);
    expect(readdirSync(projectDirectory).filter((name) => /^Clipboard .*\.png$/.test(name))).toHaveLength(2);

    const tempPath = await application.evaluate(({ app }) => app.getPath('temp'));
    await expect.poll(() => readdirSync(tempPath).filter((name) => name.startsWith('serpent-clipboard-'))).toEqual([]);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('returns specific safe desktop-ingestion errors and records their diagnostic causes', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-desktop-errors-e2e-'));
  const invalidClipboardSource = path.join(temporaryRoot, 'not-an-image.bin');
  writeFileSync(invalidClipboardSource, 'not an image');
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_CLIPBOARD_IMAGE_PATH: invalidClipboardSource,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill('桌面导入错误验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();

    const pasteResult = await pasteClipboardImage(window);
    expect(pasteResult).toMatchObject({ ok: false, error: { code: 'CLIPBOARD_IMAGE_NOT_FOUND' } });

    const invalidDrop = await window.evaluate(async () => {
      const bridge = window as unknown as {
        serpent: { library: {
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
          importDropped(input: { libraryId: string; files: unknown[] }): Promise<{ ok: boolean; error?: { code: string } }>;
        } };
      };
      const libraries = await bridge.serpent.library.listOpen();
      return bridge.serpent.library.importDropped({
        libraryId: libraries.value?.[0]?.libraryId ?? 'missing',
        files: [{}],
      });
    });
    expect(invalidDrop).toMatchObject({ ok: false, error: { code: 'INVALID_DROP_SELECTION' } });

    const logsPath = await application.evaluate(({ app }) => app.getPath('logs'));
    const logPath = path.join(logsPath, 'serpent.log');
    await expect.poll(() => readFileSync(logPath, 'utf8')).toContain('desktop-ingestion.clipboard-stage');
    await expect.poll(() => readFileSync(logPath, 'utf8')).toContain('desktop-ingestion.drop-file-handle');
  } finally {
    await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

async function pasteClipboardImage(
  window: Page,
  folderName?: string,
  collectionName?: string,
): Promise<{
  ok: boolean;
  value?: { importId?: string };
  error?: { code: string; message?: string };
}> {
  return window.evaluate(async ({ folderName: targetFolderName, collectionName: targetCollectionName }) => {
    interface Result<T> { ok: boolean; value?: T; error?: { code: string; message?: string } }
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listFolders(input: { libraryId: string }): Promise<Result<Array<{ folderId: string; name: string }>>>;
          listCollections(input: { libraryId: string }): Promise<Result<Array<{ collectionId: string; name: string }>>>;
          pasteClipboardImage(input: {
            libraryId: string;
            targetFolderId?: string;
            targetCollectionId?: string;
          }): Promise<Result<{ importId?: string }>>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const folders = await bridge.serpent.library.listFolders({ libraryId });
    const targetFolderId = targetFolderName === undefined
      ? undefined
      : folders.value?.find((folder) => folder.name === targetFolderName)?.folderId;
    const collections = await bridge.serpent.library.listCollections({ libraryId });
    const targetCollectionId = targetCollectionName === undefined
      ? undefined
      : collections.value?.find((collection) => collection.name === targetCollectionName)?.collectionId;
    return bridge.serpent.library.pasteClipboardImage({
      libraryId,
      ...(targetFolderId === undefined ? {} : { targetFolderId }),
      ...(targetCollectionId === undefined ? {} : { targetCollectionId }),
    });
  }, { folderName, collectionName });
}

async function resolveClipboardConflict(window: Page, importId: string): Promise<boolean> {
  return window.evaluate(async (token) => {
    const bridge = globalThis as typeof globalThis & {
      serpent: { library: { resolveImport(input: {
        importId: string;
        suspectedDuplicate: 'create-copy';
        nameConflict: 'keep-both';
      }): Promise<{ ok: boolean }> } };
    };
    return (await bridge.serpent.library.resolveImport({
      importId: token,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    })).ok;
  }, importId);
}
