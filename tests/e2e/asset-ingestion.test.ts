import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

import {
  closeLibraryViaSwitcher,
  resolveElectronExecutablePath,
} from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

/**
 * Locates a managed folder's sidebar nav row by its label text. Folder cards
 * only render in a managed-folder/root view (not the default "所有资产" scope
 * — FOLDER-010), and the nav label ellipsis-truncates in narrow panes (which
 * clips the text node and breaks an accessible-name match), so target the
 * label text + ancestor row instead of getByRole('button', { name }).
 */
function sidebarFolderRow(window: Page, folderName: string) {
  return window
    .locator('.navigation-pane .nav-row-label', { hasText: folderName })
    .locator("xpath=ancestor::button[contains(@class, 'nav-row')]");
}

test('imports files and a directory hierarchy, then reconciles external changes', async () => {
  const testInfo = test.info();
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-ingestion-e2e-'));
  const sourceRoot = path.join(temporaryRoot, 'sources');
  const sourceDirectory = path.join(sourceRoot, '角色参考');
  const nestedSourceDirectory = path.join(sourceDirectory, '正面');
  const emptySourceDirectory = path.join(sourceDirectory, '空目录');
  const imageSource = path.join(sourceRoot, 'hero.png');
  const notesSource = path.join(sourceRoot, 'notes.txt');
  const nestedSource = path.join(nestedSourceDirectory, 'pose.webp');
  const libraryName = '资产导入验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  mkdirSync(nestedSourceDirectory, { recursive: true });
  mkdirSync(emptySourceDirectory);
  writeFileSync(imageSource, Buffer.from('image-v1'));
  writeFileSync(notesSource, 'asset notes');
  writeFileSync(nestedSource, Buffer.from('pose-v1'));

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: [imageSource, notesSource].join(path.delimiter),
      SERPENT_E2E_IMPORT_FOLDER: sourceDirectory,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByRole('heading', { name: '导入资产以开始整理' })).toBeVisible();

    await window.getByRole('button', { name: '添加文件夹' }).click();
    await window.getByLabel("新文件夹名称").fill('项目');
    await window.keyboard.press("Enter");
    await expect(sidebarFolderRow(window, '项目')).toBeVisible();
    await sidebarFolderRow(window, '项目').click();

    await window.getByRole('button', { name: '添加文件夹' }).click();
    await window.getByLabel("新文件夹名称").fill('角色');
    await window.keyboard.press("Enter");
    await expect(sidebarFolderRow(window, '角色')).toBeVisible();

    await sidebarFolderRow(window, '项目').click();
    // File imports are exposed through the typed import contract; the library
    // switcher now owns folder/library transfers only and this folder is no
    // longer guaranteed to render the empty-canvas CTA after navigation.
    await importFilesToProject(window);
    await expect(window.getByText('hero.png', { exact: true })).toBeVisible();
    await expect(window.getByText('notes.txt', { exact: true })).toBeVisible();
    expect(readFileSync(path.join(libraryPath, 'Assets', '项目', 'hero.png'), 'utf8')).toBe('image-v1');
    expect(readFileSync(path.join(libraryPath, 'Assets', '项目', 'notes.txt'), 'utf8')).toBe('asset notes');

    writeFileSync(imageSource, Buffer.from('image-v2-different'));
    const abandoned = await prepareAndAbandonConflict(window);
    expect(JSON.stringify(abandoned.plan)).not.toContain(sourceRoot);
    // Both re-imports collide on destination basename → name conflicts only
    // (IMPORT-007: path/name wins over content-duplicate classification).
    expect(abandoned.plan.suspectedDuplicateCount).toBe(0);
    expect(abandoned.plan.nameConflictCount).toBe(2);
    expect(abandoned.replayOk).toBe(false);
    expect(abandoned.replayErrorCode).toBeTruthy();
    const operationsPath = path.join(libraryPath, '.serpent', 'operations');
    expect(existsSync(operationsPath) ? readdirSync(operationsPath, { recursive: true }) : []).toHaveLength(0);

    // The non-empty canvas no longer duplicates the library switcher's import
    // actions. Drive the same typed preload import contract so this test keeps
    // covering the conflict plan and its atomic resolution.
    const conflictPlan = await importFilesAndResolveConflict(window);
    expect(conflictPlan).toMatchObject({ suspectedDuplicateCount: 0, nameConflictCount: 2 });
    const assetsAfterCopy = await listAllAssets(window);
    expect(assetsAfterCopy.filter((asset) => asset.displayName.startsWith('hero')).length).toBe(2);
    expect(assetsAfterCopy.filter((asset) => asset.displayName.startsWith('notes')).length).toBe(2);

    await sidebarFolderRow(window, '角色').click();
    await window.getByRole('button', { name: /资源库菜单|当前资源库/ }).click();
    await window.getByRole('menuitem', { name: '导入文件夹', exact: true }).click();
    await expect(sidebarFolderRow(window, '正面')).toBeVisible();
    await sidebarFolderRow(window, '正面').click();
    await expect(window.getByText('pose.webp', { exact: true })).toBeVisible();
    const importedNestedPath = path.join(
      libraryPath,
      'Assets',
      '项目',
      '角色',
      '角色参考',
      '正面',
      'pose.webp',
    );
    expect(existsSync(importedNestedPath)).toBe(true);
    expect(existsSync(path.join(libraryPath, 'Assets', '项目', '角色', '角色参考', '空目录'))).toBe(true);

    const beforeExternalChange = await listAllAssets(window);
    const heroBefore = beforeExternalChange.find((asset) => asset.displayName === 'hero.png');
    const poseBefore = beforeExternalChange.find((asset) => asset.displayName === 'pose.webp');
    expect(heroBefore).toBeDefined();
    expect(poseBefore).toBeDefined();

    writeFileSync(path.join(libraryPath, 'Assets', '项目', 'hero.png'), Buffer.from('image-v2-longer'));
    unlinkSync(importedNestedPath);
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await expect(
      window.locator('.missing-overlay[aria-label="文件丢失"]').first(),
    ).toBeVisible();
    const missingScreenshot = testInfo.outputPath('external-missing.png');
    await window.screenshot({ path: missingScreenshot });
    await testInfo.attach('external-missing', { path: missingScreenshot, contentType: 'image/png' });

    const afterExternalChange = await listAllAssets(window);
    const heroAfter = afterExternalChange.find((asset) => asset.displayName === 'hero.png');
    const poseAfter = afterExternalChange.find((asset) => asset.displayName === 'pose.webp');
    expect(heroAfter?.assetId).toBe(heroBefore?.assetId);
    expect(heroAfter?.currentRevisionId).not.toBe(heroBefore?.currentRevisionId);
    expect(heroAfter?.availability).toBe('available');
    expect(poseAfter?.assetId).toBe(poseBefore?.assetId);
    expect(poseAfter?.availability).toBe('missing');

    const repeatedMissingRefresh = await refreshAllAssets(window);
    expect(repeatedMissingRefresh.changedCount).toBe(0);
    expect(repeatedMissingRefresh.missingCount).toBe(0);
    writeFileSync(importedNestedPath, Buffer.from('pose-restored'));
    const restored = await refreshAllAssets(window);
    const restoredPose = restored.assets.find((asset) => asset.displayName === 'pose.webp');
    expect(restoredPose?.assetId).toBe(poseBefore?.assetId);
    expect(restoredPose?.availability).toBe('available');
    expect(restoredPose?.currentRevisionId).not.toBe(poseBefore?.currentRevisionId);
    unlinkSync(importedNestedPath);
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();

    const pendingBeforeClose = await preparePendingConflict(window);
    expect(pendingBeforeClose.forgedTokenAccepted).toBe(false);
    await closeLibraryViaSwitcher(window, libraryName);
    expect(existsSync(operationsPath) ? readdirSync(operationsPath, { recursive: true }) : []).toHaveLength(0);
    expect(await resolveImportToken(window, pendingBeforeClose.importId)).toBe(false);
    await window.getByRole('button', { name: '打开资源库' }).click();
    await expect(sidebarFolderRow(window, '项目')).toBeVisible();
    const afterReopen = await listAllAssets(window);
    expect(afterReopen.find((asset) => asset.displayName === 'hero.png')?.assetId).toBe(heroBefore?.assetId);
    expect(afterReopen.find((asset) => asset.displayName === 'pose.webp')?.availability).toBe('missing');
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('shows a specific safe import reason and persists the complete Worker error', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-error-log-e2e-'));
  const sourceDirectory = path.join(temporaryRoot, 'source-with-link');
  const outsideFile = path.join(temporaryRoot, 'outside.png');
  const libraryName = '错误日志验收';
  mkdirSync(sourceDirectory);
  writeFileSync(outsideFile, 'outside');
  symlinkSync(outsideFile, path.join(sourceDirectory, 'linked.png'));

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FOLDER: sourceDirectory,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件夹', exact: true }).first().click();
    await expect(window.getByRole('alertdialog')).toContainText(
      '原因：目录中包含当前切片不支持的符号链接。',
    );

    const logsPath = await application.evaluate(({ app }) => app.getPath('logs'));
    const logPath = path.join(logsPath, 'serpent.log');
    await expect.poll(() => readFileSync(logPath, 'utf8')).toContain('SYMBOLIC_LINK_NOT_ALLOWED');
    expect(readFileSync(logPath, 'utf8')).toContain('worker.request');
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('maps a real filesystem permission failure and logs its complete cause chain', async () => {
  test.skip(process.platform === 'win32', 'POSIX permissions are verified on macOS/Linux.');
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-permission-log-e2e-'));
  const sourceDirectory = path.join(temporaryRoot, 'unreadable-source');
  const libraryName = '权限错误验收';
  mkdirSync(sourceDirectory);
  writeFileSync(path.join(sourceDirectory, 'hidden.png'), 'hidden');

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FOLDER: sourceDirectory,
    },
  });

  try {
    const logsPath = await application.evaluate(({ app }) => app.getPath('logs'));
    const logPath = path.join(logsPath, 'serpent.log');
    const logOffset = existsSync(logPath) ? readFileSync(logPath).length : 0;
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    chmodSync(sourceDirectory, 0o000);
    await window.getByRole('button', { name: '导入文件夹', exact: true }).first().click();
    await expect(window.getByRole('alertdialog')).toContainText(
      '原因：当前用户没有读取源文件或写入目标位置的权限。',
    );

    await expect.poll(() => readFileSync(logPath, 'utf8').slice(logOffset)).toContain('EACCES');
    const diagnostic = readFileSync(logPath, 'utf8').slice(logOffset);
    expect(diagnostic).toContain('worker.request');
    expect(diagnostic).toContain('asset.import.prepare');
    expect(diagnostic).toContain('LibraryServiceError');
    expect(diagnostic).toContain('cause');
    expect(diagnostic).toContain('stack');
  } finally {
    chmodSync(sourceDirectory, 0o700);
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

interface AssetSnapshot {
  assetId: string;
  displayName: string;
  currentRevisionId: string;
  availability: 'available' | 'missing';
}

async function listAllAssets(window: Page): Promise<AssetSnapshot[]> {
  return window.evaluate(async () => {
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
          listAssets(input: {
            libraryId: string;
            recursive: boolean;
          }): Promise<{ ok: boolean; value?: AssetSnapshot[] }>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const result = await bridge.serpent.library.listAssets({ libraryId, recursive: true });
    if (!result.ok || !result.value) throw new Error('Could not list assets.');
    return result.value;
  });
}

async function prepareAndAbandonConflict(window: Page): Promise<{
  plan: {
    suspectedDuplicateCount: number;
    nameConflictCount: number;
  };
  replayOk: boolean;
  replayErrorCode?: string;
}> {
  return window.evaluate(async () => {
    interface Result<T> {
      ok: boolean;
      value?: T;
      error?: { code: string };
    }
    interface ConflictPlan {
      importId: string;
      suspectedDuplicateCount: number;
      nameConflictCount: number;
    }
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listFolders(input: { libraryId: string }): Promise<Result<Array<{ folderId: string; name: string }>>>;
          importFiles(input: { libraryId: string; targetFolderId?: string }): Promise<Result<ConflictPlan>>;
          abandonImport(input: { importId: string }): Promise<Result<{ importId: string }>>;
          resolveImport(input: {
            importId: string;
            suspectedDuplicate: 'skip';
            nameConflict: 'keep-both';
          }): Promise<Result<unknown>>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const folders = await bridge.serpent.library.listFolders({ libraryId });
    const targetFolderId = folders.value?.find((folder) => folder.name === '项目')?.folderId;
    if (!folders.ok || !targetFolderId) throw new Error('Expected the project folder.');
    const prepared = await bridge.serpent.library.importFiles({ libraryId, targetFolderId });
    if (!prepared.ok || !prepared.value || !('importId' in prepared.value)) {
      throw new Error('Expected an import conflict plan.');
    }
    const plan = prepared.value;
    const abandoned = await bridge.serpent.library.abandonImport({ importId: plan.importId });
    if (!abandoned.ok) throw new Error('Could not abandon the conflict plan.');
    const replay = await bridge.serpent.library.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    return {
      plan,
      replayOk: replay.ok,
      replayErrorCode: replay.error?.code,
    };
  });
}

async function importFilesAndResolveConflict(window: Page): Promise<{
  suspectedDuplicateCount: number;
  nameConflictCount: number;
}> {
  return window.evaluate(async () => {
    interface Result<T> {
      ok: boolean;
      value?: T;
      error?: { code: string };
    }
    interface Folder { folderId: string; name: string }
    interface Plan {
      importId: string;
      suspectedDuplicateCount: number;
      nameConflictCount: number;
    }
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listFolders(input: { libraryId: string }): Promise<Result<Folder[]>>;
          importFiles(input: { libraryId: string; targetFolderId?: string }): Promise<Result<Plan>>;
          resolveImport(input: {
            importId: string;
            suspectedDuplicate: 'create-copy';
            nameConflict: 'keep-both';
          }): Promise<Result<unknown>>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const folders = await bridge.serpent.library.listFolders({ libraryId });
    const targetFolderId = folders.value?.find((folder) => folder.name === '项目')?.folderId;
    if (!folders.ok || !targetFolderId) throw new Error('Expected the project folder.');
    const prepared = await bridge.serpent.library.importFiles({ libraryId, targetFolderId });
    if (!prepared.ok || !prepared.value || !('importId' in prepared.value)) {
      throw new Error('Expected an import conflict plan.');
    }
    const plan = prepared.value;
    const resolved = await bridge.serpent.library.resolveImport({
      importId: plan.importId,
      suspectedDuplicate: 'create-copy',
      nameConflict: 'keep-both',
    });
    if (!resolved.ok) throw new Error('Could not resolve the import conflict plan.');
    return plan;
  });
}

async function importFilesToProject(window: Page): Promise<void> {
  await window.evaluate(async () => {
    interface Result<T> { ok: boolean; value?: T; error?: { code: string } }
    interface Folder { folderId: string; name: string }
    interface Completion { assets: unknown[] }
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listFolders(input: { libraryId: string }): Promise<Result<Folder[]>>;
          importFiles(input: { libraryId: string; targetFolderId?: string }): Promise<Result<Completion>>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const folders = await bridge.serpent.library.listFolders({ libraryId });
    const targetFolderId = folders.value?.find((folder) => folder.name === '项目')?.folderId;
    if (!folders.ok || !targetFolderId) throw new Error('Expected the project folder.');
    const imported = await bridge.serpent.library.importFiles({ libraryId, targetFolderId });
    if (!imported.ok || !imported.value || !('assets' in imported.value)) {
      throw new Error('Expected the initial file import to complete.');
    }
  });
}

async function preparePendingConflict(window: Page): Promise<{
  importId: string;
  forgedTokenAccepted: boolean;
}> {
  return window.evaluate(async () => {
    interface Result<T> {
      ok: boolean;
      value?: T;
    }
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          listFolders(input: { libraryId: string }): Promise<Result<Array<{ folderId: string; name: string }>>>;
          importFiles(input: { libraryId: string; targetFolderId?: string }): Promise<Result<{ importId: string }>>;
          resolveImport(input: {
            importId: string;
            suspectedDuplicate: 'skip';
            nameConflict: 'keep-both';
          }): Promise<Result<unknown>>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const folders = await bridge.serpent.library.listFolders({ libraryId });
    const targetFolderId = folders.value?.find((folder) => folder.name === '项目')?.folderId;
    if (!folders.ok || !targetFolderId) throw new Error('Expected the project folder.');
    const prepared = await bridge.serpent.library.importFiles({ libraryId, targetFolderId });
    if (!prepared.ok || !prepared.value || !('importId' in prepared.value)) {
      throw new Error('Expected a pending conflict plan.');
    }
    const forged = await bridge.serpent.library.resolveImport({
      importId: 'forged-import-token',
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    });
    return { importId: prepared.value.importId, forgedTokenAccepted: forged.ok };
  });
}

async function resolveImportToken(window: Page, importId: string): Promise<boolean> {
  return window.evaluate(async (token) => {
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          resolveImport(input: {
            importId: string;
            suspectedDuplicate: 'skip';
            nameConflict: 'keep-both';
          }): Promise<{ ok: boolean }>;
        };
      };
    };
    return (await bridge.serpent.library.resolveImport({
      importId: token,
      suspectedDuplicate: 'skip',
      nameConflict: 'keep-both',
    })).ok;
  }, importId);
}

async function refreshAllAssets(window: Page): Promise<{
  changedCount: number;
  missingCount: number;
  assets: AssetSnapshot[];
}> {
  return window.evaluate(async () => {
    interface Result<T> {
      ok: boolean;
      value?: T;
    }
    const bridge = globalThis as typeof globalThis & {
      serpent: {
        library: {
          listOpen(): Promise<Result<Array<{ libraryId: string }>>>;
          refreshAssets(input: { libraryId: string }): Promise<Result<{
            changedCount: number;
            missingCount: number;
            assets: AssetSnapshot[];
          }>>;
        };
      };
    };
    const open = await bridge.serpent.library.listOpen();
    const libraryId = open.value?.[0]?.libraryId;
    if (!open.ok || !libraryId) throw new Error('Expected an open library.');
    const result = await bridge.serpent.library.refreshAssets({ libraryId });
    if (!result.ok || !result.value) throw new Error('Could not refresh assets.');
    return result.value;
  });
}
