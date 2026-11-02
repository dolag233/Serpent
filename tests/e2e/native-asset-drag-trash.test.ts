import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';

import { assetCard, resolveElectronExecutablePath, waitForLibraryLoadingToFinish } from './electron-test-helpers';

const ASSET_NAME = 'native-trash-probe.png';

test.describe.configure({ timeout: 120_000 });

function trashRow(window: Page): Locator {
  return window
    .locator('.navigation-pane button.nav-row')
    .filter({ hasText: '回收站' })
    .first();
}

async function launchApplication(
  applicationDirectory: string,
  temporaryRoot: string,
  libraryPath: string,
): Promise<ElectronApplication> {
  return electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_SHOW_INACTIVE: '1',
      SERPENT_E2E_NATIVE_ASSET_DRAG: '1',
      SERPENT_E2E_RESTORE_RECENT: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: path.join(temporaryRoot, ASSET_NAME),
    },
  });
}

async function expectDecodedImage(card: Locator): Promise<void> {
  const image = card.locator('img').first();
  await expect
    .poll(() => image.evaluate((node) => {
      const imageElement = node as HTMLImageElement;
      return imageElement.complete && imageElement.naturalWidth > 0;
    }))
    .toBe(true);
}

async function expectPersistentThumbnailDecoded(card: Locator): Promise<void> {
  const image = card.locator('img').first();
  await expect
    .poll(() => image.getAttribute('src'), { timeout: 30_000 })
    .toMatch(/^serpent:\/\/preview\//);
  await expectDecodedImage(card);
}

async function installNativeDragStartSpy(application: ElectronApplication): Promise<void> {
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!window) throw new Error('The application window is unavailable.');
    const testGlobal = globalThis as typeof globalThis & {
      __serpentNativeDragStartFiles?: string[][];
    };
    testGlobal.__serpentNativeDragStartFiles = [];
    window.webContents.startDrag = (item) => {
      testGlobal.__serpentNativeDragStartFiles?.push(
        item.files ? [...item.files] : [item.file],
      );
    };
  });
}

async function readNativeDragStartFiles(
  application: ElectronApplication,
): Promise<string[][]> {
  return application.evaluate(() => {
    const testGlobal = globalThis as typeof globalThis & {
      __serpentNativeDragStartFiles?: string[][];
    };
    return testGlobal.__serpentNativeDragStartFiles ?? [];
  });
}

async function readTrashRequestCount(window: Page): Promise<number> {
  return window.evaluate(() => {
    const renderer = globalThis as typeof globalThis & {
      serpent?: { e2e?: { getRequestCount?: (type: string) => number } };
    };
    return renderer.serpent?.e2e?.getRequestCount?.('asset.trash.request') ?? 0;
  });
}

test('native asset drag with copy/link source reaches trash and survives restart', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-native-trash-e2e-'));
  const sourcePath = path.join(temporaryRoot, ASSET_NAME);
  const libraryName = 'Native drag regression';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  await sharp({
    create: {
      width: 3072,
      height: 1536,
      channels: 3,
      background: { r: 80, g: 130, b: 200 },
    },
  }).png().toFile(sourcePath);

  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(applicationDirectory, temporaryRoot, libraryPath);
    let window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await expect(window.getByRole('heading', { name: '导入资产以开始整理' })).toBeVisible();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();

    const card = assetCard(window, ASSET_NAME);
    await expect(card).toBeVisible();
    const assetId = await card.getAttribute('data-asset-id');
    expect(assetId).toBeTruthy();
    await expectDecodedImage(card);
    // Active image cards can temporarily decode the original source directly.
    // Trash cards need the persistent thumbnail artifact, so wait for the
    // preview URL and its decode before moving the source file away.
    await expectPersistentThumbnailDecoded(card);
    // Native drag cannot begin until Main has validated the file paths.
    await expect(card).toHaveAttribute('draggable', 'true', { timeout: 30_000 });
    await installNativeDragStartSpy(application);

    // This synthetic source event invokes the real asset-card native branch.
    // Main still executes the real cache lookup and startNativeAssetDrag; only
    // the OS handoff is replaced so the test stays hidden and deterministic.
    await card.dispatchEvent('dragstart');
    await expect.poll(() => readNativeDragStartFiles(application!)).toHaveLength(1);
    const [startedFilePaths] = await readNativeDragStartFiles(application);
    const startedAssetPath = startedFilePaths?.[0];
    expect(startedAssetPath).toBeTruthy();
    expect(existsSync(startedAssetPath!)).toBe(true);

    const target = trashRow(window);
    await expect(target).toBeVisible();
    const bounds = await target.boundingBox();
    expect(bounds).not.toBeNull();
    const cdp = await window.context().newCDPSession(window);
    const dragData = {
      items: [],
      files: [startedAssetPath!],
      // Electron Windows/Linux startDrag source allows COPY | LINK only.
      dragOperationsMask: 3,
    };
    try {
      const point = {
        x: bounds!.x + bounds!.width / 2,
        y: bounds!.y + bounds!.height / 2,
      };
      await cdp.send('Input.dispatchDragEvent', {
        type: 'dragEnter', ...point, data: dragData,
      });
      await cdp.send('Input.dispatchDragEvent', {
        type: 'dragOver', ...point, data: dragData,
      });
      await cdp.send('Input.dispatchDragEvent', {
        type: 'drop', ...point, data: dragData,
      });
    } finally {
      await cdp.detach();
    }

    await expect.poll(() => readTrashRequestCount(window)).toBeGreaterThan(0);
    await expect(card).toHaveCount(0);
    expect(existsSync(startedAssetPath!)).toBe(false);
    expect(
      existsSync(path.join(libraryPath, '.serpent', 'trash', assetId!, ASSET_NAME)),
    ).toBe(true);

    await target.click();
    const trashedCard = assetCard(window, ASSET_NAME);
    await expect(trashedCard).toBeVisible();
    await expectDecodedImage(trashedCard);

    await application.evaluate(({ app }) => app.quit());
    await application.close();
    application = undefined;

    application = await launchApplication(applicationDirectory, temporaryRoot, libraryPath);
    window = await application.firstWindow();
    await waitForLibraryLoadingToFinish(window);
    await trashRow(window).click();
    const persistedCard = assetCard(window, ASSET_NAME);
    await expect(persistedCard).toBeVisible();
    await expectDecodedImage(persistedCard);
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.quit()).catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('a renamed source cannot start a native drag until Main refreshes its validated path', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-native-drag-rename-e2e-'));
  const renamedName = 'native-trash-probe-renamed.png';
  const libraryName = 'Native drag path refresh';
  const libraryPath = path.join(temporaryRoot, libraryName);
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: '#4382bc' },
  }).png().toFile(path.join(temporaryRoot, ASSET_NAME));
  let application: ElectronApplication | undefined;
  try {
    application = await launchApplication(applicationDirectory, temporaryRoot, libraryPath);
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const originalCard = assetCard(window, ASSET_NAME);
    await expect(originalCard).toHaveAttribute('draggable', 'true', { timeout: 30_000 });
    const assetId = await originalCard.getAttribute('data-asset-id');
    expect(assetId).toBeTruthy();
    await installNativeDragStartSpy(application);
    await window.evaluate(() => {
      const testGlobal = globalThis as typeof globalThis & {
        __nativeDragReadinessTypes?: string[];
        serpent: { library: {
          onNativeDragReadiness(listener: (event: { type: string }) => void): () => void;
        } };
      };
      testGlobal.__nativeDragReadinessTypes = [];
      testGlobal.serpent.library.onNativeDragReadiness((event) => {
        testGlobal.__nativeDragReadinessTypes?.push(event.type);
      });
    });

    await window.evaluate(async ({ id, newName }) => {
      const bridge = (globalThis as typeof globalThis & {
        serpent: { library: {
          listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
          renameAssetFile(input: { libraryId: string; assetId: string; newFileName: string }): Promise<{ ok: boolean }>;
        } };
      }).serpent.library;
      const opened = await bridge.listOpen();
      if (!opened.ok || !opened.value?.[0]) throw new Error('No open test library.');
      const renamed = await bridge.renameAssetFile({
        libraryId: opened.value[0].libraryId, assetId: id, newFileName: newName,
      });
      if (!renamed.ok) throw new Error('Could not rename the test asset.');
    }, { id: assetId!, newName: renamedName });

    const renamedCard = assetCard(window, renamedName);
    await expect(renamedCard).toBeVisible();
    await expect.poll(() => window.evaluate(() => (
      globalThis as typeof globalThis & { __nativeDragReadinessTypes?: string[] }
    ).__nativeDragReadinessTypes ?? [])).toContain('clear');
    await expect(renamedCard).toHaveAttribute('draggable', 'true', { timeout: 30_000 });
    await renamedCard.dispatchEvent('dragstart');
    await expect.poll(() => readNativeDragStartFiles(application!)).toHaveLength(1);
    const draggedPath = (await readNativeDragStartFiles(application))[0]?.[0];
    expect(draggedPath).toBeTruthy();
    expect(path.basename(draggedPath!)).toBe(renamedName);
    expect(existsSync(draggedPath!)).toBe(true);
  } finally {
    if (application) {
      await application.evaluate(({ app }) => app.quit()).catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
