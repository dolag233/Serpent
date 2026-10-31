import { mkdtempSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

import type { LibraryApiResult, SerpentLibraryApi } from '../../src/shared/library-api';
import {
  assetCard,
  electronLaunchEnv,
  resolveElectronExecutablePath,
  waitForLibraryLoadingToFinish,
} from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

async function expectFolders(window: Page, names: string[]) {
  await expect.poll(async () =>
    (await window.locator('.folder-card-name').allTextContents()).sort(),
  ).toEqual([...names].sort());
}

async function selectTag(window: Page, name: string, exclude = false) {
  // Hover opens settings without toggling the dimension's remembered filters.
  await window.getByRole('button', { name: '标签', exact: true }).hover();
  await window.getByRole('textbox', { name: '标签过滤' }).fill(name);
  await window.getByRole('option', { name: new RegExp(`^${name}\\s*\\d+$`) })
    .getByRole('button').click({ button: exclude ? 'right' : 'left' });
  await window.keyboard.press('Escape');
}

test('toolbar filters hide empty folder subtrees and refresh after metadata edits', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-filtered-folders-e2e-'));
  const sourcePaths = ['deep.png', 'skip.png', 'both.png'].map((name) => path.join(temporaryRoot, name));
  for (const [index, sourcePath] of sourcePaths.entries()) {
    await sharp({
      create: { width: 64, height: 48, channels: 4, background: {
        r: 50 + index * 70, g: 150, b: 200 - index * 60, alpha: 1,
      } },
    }).png().toFile(sourcePath);
  }

  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath: resolveElectronExecutablePath(),
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_E2E_HIDE_WINDOW: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePaths.join(path.delimiter),
    }),
  });

  try {
    const window = await application.firstWindow();
    window.setDefaultTimeout(10_000);
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill('Filtered folder fixture');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await waitForLibraryLoadingToFinish(window);

    // Seed only the temporary library through the typed public preload API.
    const fixture = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & {
        serpent: { library: SerpentLibraryApi };
      }).serpent.library;
      function value<T>(result: LibraryApiResult<T>): T {
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      }
      const libraryId = value(await api.listOpen())[0]?.libraryId;
      if (!libraryId) throw new Error('Missing isolated library.');
      const imported = value(await api.importFiles({ libraryId, detectImageSequences: false }));
      if (!('assets' in imported) || imported.assets.length !== 3) {
        throw new Error('Expected three imported PNG assets.');
      }
      const scope = value(await api.createFolder({ libraryId, name: 'FixtureScope' }));
      const createFolder = async (name: string, parentFolderId = scope.folderId) =>
        value(await api.createFolder({ libraryId, name, parentFolderId }));
      const deep = await createFolder('Deep');
      const grandchild = await createFolder('Grandchild', deep.folderId);
      const skip = await createFolder('SkipOnly');
      const both = await createFolder('BothTags');
      await createFolder('Empty');
      const keepTag = value(await api.createTag({ libraryId, name: 'Keep' }));
      const skipTag = value(await api.createTag({ libraryId, name: 'Skip' }));
      for (const asset of imported.assets) {
        const isDeep = asset.displayName === 'deep.png';
        const isBoth = asset.displayName === 'both.png';
        value(await api.moveAssets({
          libraryId, assetIds: [asset.assetId],
          targetFolderId: isDeep ? grandchild.folderId : isBoth ? both.folderId : skip.folderId,
        }));
        value(await api.assignTags({
          libraryId, assetIds: [asset.assetId],
          tagIds: isDeep ? [keepTag.tagId] : isBoth ? [keepTag.tagId, skipTag.tagId] : [skipTag.tagId],
        }));
        value(await api.setAssetsRating({ libraryId, assetIds: [asset.assetId], rating: isBoth ? 4 : 5 }));
      }
      return { libraryId, scopeId: scope.folderId, deepId: deep.folderId, grandchildId: grandchild.folderId };
    });
    const refresh = window.getByRole('button', { name: '刷新磁盘变化' });
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 15_000 });
    const scopeRow = window.locator(`.navigation-pane [data-nav-folder-id="${fixture.scopeId}"]`);
    await scopeRow.click();
    const allFolders = ['BothTags', 'Deep', 'Empty', 'SkipOnly'];
    await expectFolders(window, allFolders);

    // A folder-name search alone still finds a genuinely empty folder.
    const search = window.getByRole('combobox', { name: '搜索资源库' });
    await search.fill('Empty');
    await expectFolders(window, ['Empty']);
    await search.fill('');
    await expectFolders(window, allFolders);

    await selectTag(window, 'Keep');
    await expectFolders(window, ['BothTags', 'Deep']);
    await expect(window.locator(`.folder-card[data-folder-id="${fixture.deepId}"] .folder-card-count`))
      .toContainText('1');
    // Include Keep AND exclude Skip; a match two levels down preserves Deep.
    await selectTag(window, 'Skip', true);
    await expectFolders(window, ['Deep']);
    await window.screenshot({ path: test.info().outputPath('filtered-folders.png'), timeout: 5_000 });
    await window.getByRole('button', { name: '全部清除', exact: true }).click();
    await expectFolders(window, allFolders);

    await window.getByRole('button', { name: '评分', exact: true }).hover();
    await window.getByRole('button', { name: '5★', exact: true }).click();
    await window.keyboard.press('Escape');
    await expectFolders(window, ['Deep', 'SkipOnly']);
    await selectTag(window, 'Keep');
    await expectFolders(window, ['Deep']);

    // Enter the retained subtree, decode its real thumbnail, then remove its
    // last rating match through the Inspector rather than refreshing the app.
    await window.locator(`.folder-card[data-folder-id="${fixture.deepId}"]`).dblclick();
    await expectFolders(window, ['Grandchild']);
    await window.locator(`.folder-card[data-folder-id="${fixture.grandchildId}"]`).dblclick();
    const deepAsset = assetCard(window, 'deep.png');
    await expect(deepAsset).toBeVisible();
    const thumbnail = deepAsset.locator('img').first();
    await expect(thumbnail).toBeVisible({ timeout: 15_000 });
    expect(await thumbnail.evaluate(async (image: HTMLImageElement) => {
      await image.decode();
      return image.naturalWidth > 0 && image.naturalHeight > 0;
    })).toBe(true);
    await deepAsset.click();
    await window.getByRole('button', { name: '4 星', exact: true }).click();
    await expect(deepAsset).toHaveCount(0);
    await scopeRow.click();
    await expectFolders(window, []);
    await window.getByRole('button', { name: '全部清除', exact: true }).click();
    await expectFolders(window, allFolders);
  } catch (error) {
    const window = await application.firstWindow();
    await test.info().attach('failure-ui', { body: await window.locator('body').innerText(), contentType: 'text/plain' });
    throw error;
  } finally {
    await application.close();
    // Delete only the uniquely generated temporary fixture directory.
    assert.equal(path.dirname(path.resolve(temporaryRoot)), path.resolve(tmpdir()));
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
