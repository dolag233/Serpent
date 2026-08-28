import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type Page } from '@playwright/test';

import {
  assetCard as locateAssetCard,
  resolveElectronExecutablePath,
} from './electron-test-helpers';

function sidebarSmartCollectionRow(window: Page, name: string) {
  return window
    .locator('.navigation-pane button.nav-row')
    .filter({ hasText: name })
    .first();
}

function collectionRow(window: Page, name: string) {
  return window
    .locator('.navigation-pane button.nav-row[data-nav-collection-id]')
    .filter({ hasText: name })
    .first();
}

test.describe.configure({ timeout: 120_000 });

test('organizes, finds, trashes, and restores an imported asset through the UI', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-organization-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'hero.png');
  const libraryName = '组织搜索验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, Buffer.from('hero-image-content'));

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
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
      SERPENT_E2E_TRASH_DELAY_MS: '750',
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const assetCard = locateAssetCard(window, 'hero.png');
    await expect(assetCard).toBeVisible();
    const assetId = await assetCard.getAttribute('data-asset-id');
    expect(assetId).toBeTruthy();
    const readMetadataVersion = () => window.evaluate(async (selectedAssetId) => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<{
          ok: boolean;
          value?: { entityVersion: number };
        }>;
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId || !selectedAssetId) throw new Error('No selected asset');
      const metadata = await api.getAssetMetadata({ libraryId, assetId: selectedAssetId });
      return metadata.value?.entityVersion ?? -1;
    }, assetId);
    async function readStableMetadataVersion(): Promise<number> {
      let previousVersion = -1;
      let stableVersion = -1;
      await expect
        .poll(async () => {
          const currentVersion = await readMetadataVersion();
          const isStable = currentVersion === previousVersion;
          previousVersion = currentVersion;
          if (isStable) stableVersion = currentVersion;
          return isStable ? currentVersion : -1;
        })
        .toBeGreaterThanOrEqual(0);
      return stableVersion;
    }

    // The sidebar no longer enumerates or creates tags (REQ-TAG-001); seed
    // the tags through the library API, then use the explicit refresh command
    // because large-library scope navigation intentionally skips sidebar
    // queries.
    await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        createTag(input: { libraryId: string; name: string }): Promise<{ ok: boolean }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      for (const name of ['角色', '临时']) {
        const created = await api.createTag({ libraryId, name });
        if (!created.ok) throw new Error(`Could not create tag ${name}`);
      }
    });
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await window.getByRole('button', { name: /所有资产/ }).click();

    await window.getByRole('button', { name: '添加合集' }).click();
    await expect(window.getByPlaceholder('新建合集')).toBeFocused();
    await window.getByPlaceholder('新建合集').fill('精选');
    await window.getByPlaceholder('新建合集').press('Enter');
    await expect(window.getByRole('button', { name: /精选/ })).toBeVisible();

    // Creating a collection enters the new empty scope; return to all assets
    // before organizing the imported asset into it.
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(assetCard).toBeVisible();

    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签…' }).click();
    await window.getByRole('option', { name: '角色' }).click();
    const notice = window.locator('.workspace-notice-item').first();
    await expect(notice).toContainText('标签已添加');
    await expect
      .poll(async () => (await notice.boundingBox())?.height ?? Number.POSITIVE_INFINITY)
      .toBeLessThanOrEqual(56);
    await expect
      .poll(async () => (await notice.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
      .toBeLessThan(280);
    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签…' }).click();
    await window.getByRole('option', { name: '临时' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('标签已添加');
    // The sidebar no longer enumerates tags (REQ-TAG-001); enter the
    // tag-filtered view through the retained 标签过滤 entry instead.
    await window.getByRole('button', { name: '标签', exact: true }).click();
    await window.getByRole('textbox', { name: '标签过滤' }).fill('角色');
    await window.getByRole("option", { name: /角色/ }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
    // Close the tag dimension before continuing with other discovery controls.
    await window.getByRole('button', { name: '标签', exact: true }).click();

    await window.getByRole('button', { name: /所有资产/ }).click();
    await locateAssetCard(window, 'hero.png').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加到合集' }).hover();
    await window.getByRole('option', { name: '精选' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('资产已加入合集');
    await window.getByRole('button', { name: /精选/ }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();

    await window.getByRole('button', { name: /精选/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '重命名合集' }).click();
    const renameCollectionInput = window.getByRole('textbox', { name: 'nav.renameCollection' });
    await expect(renameCollectionInput).toBeVisible();
    await renameCollectionInput.fill('收藏');
    await renameCollectionInput.press('Enter');
    await expect(window.getByRole('button', { name: /收藏/ })).toBeVisible();
    await expect(window.locator('.workspace-notice')).toContainText('合集已重命名');

    await window.getByRole('button', { name: /收藏/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '编辑合集详情' }).click();
    await window.getByLabel('描述').fill('主要角色精选资产');
    await window.getByLabel('封面资产').selectOption({ label: 'hero.png' });
    await window.getByRole('button', { name: '保存详情' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('合集详情已更新');
    const collectionDetails = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listCollections(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ name: string; description: string | null; coverAssetId: string | null }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const collections = await api.listCollections({ libraryId });
      return collections.value?.find((collection) => collection.name === '收藏');
    });
    expect(collectionDetails?.description).toBe('主要角色精选资产');
    expect(collectionDetails?.coverAssetId).toBeTruthy();

    await locateAssetCard(window, 'hero.png').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '从当前合集移除' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('资产已从合集移除');
    await expect(locateAssetCard(window, 'hero.png')).toHaveCount(0);

    window.once('dialog', (dialog) => dialog.accept());
    await window.getByRole('button', { name: /收藏/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '删除合集' }).click();
    await expect(window.getByRole('button', { name: /收藏/ })).toHaveCount(0);
    await expect(window.locator('.workspace-notice')).toContainText('合集已删除');
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();

    await locateAssetCard(window, 'hero.png').click();
    await window.getByRole('button', { name: '4 星' }).click();
    await expect.poll(readMetadataVersion).toBe(1);
    await window.getByRole('button', { name: '标记喜欢' }).click();
    await expect.poll(readMetadataVersion).toBe(2);

    const descriptionInput = window.getByLabel('描述');
    const sourceUrlInput = window.getByRole('textbox', {
      name: '源链接',
      exact: true,
    });
    await descriptionInput.fill('待清空描述');
    await descriptionInput.blur();
    await expect.poll(readMetadataVersion).toBe(3);
    await sourceUrlInput.fill('javascript:alert(1)');
    await sourceUrlInput.press('Enter');
    await expect(window.getByText('保存源链接失败。原因：请输入不含账号密码的 HTTP(S) 完整链接。')).toBeVisible();
    await expect.poll(readMetadataVersion).toBe(3);
    await sourceUrlInput.fill('https://example.com/source');
    await sourceUrlInput.press('Enter');
    await expect.poll(readMetadataVersion).toBe(4);

    await descriptionInput.fill('');
    await descriptionInput.blur();
    await expect.poll(readMetadataVersion).toBeGreaterThan(4);
    const versionAfterDescriptionClear = await readMetadataVersion();
    await sourceUrlInput.fill('');
    await sourceUrlInput.press('Enter');
    await expect.poll(readMetadataVersion).toBeGreaterThan(versionAfterDescriptionClear);
    const versionAfterSourceClear = await readStableMetadataVersion();
    const clearedMetadata = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listAssets(input: { libraryId: string; folderId?: string; recursive: boolean }): Promise<{ ok: boolean; value?: Array<{ assetId: string }> }>;
        getAssetMetadata(input: { libraryId: string; assetId: string }): Promise<{ ok: boolean; value?: { description: string | null; sourcePageUrl: string | null } }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const assets = await api.listAssets({ libraryId, recursive: true });
      const assetId = assets.value?.[0]?.assetId;
      if (!assetId) throw new Error('No imported asset');
      const metadata = await api.getAssetMetadata({ libraryId, assetId });
      return metadata.value;
    });
    expect(clearedMetadata).toMatchObject({ description: null, sourcePageUrl: null });
    // Leaving the description field and clicking a rating are one user gesture.
    // Both saves must be serialized locally instead of racing with the same version.
    const versionBeforeRapidEdit = versionAfterSourceClear;
    await descriptionInput.fill('快速连续修改的描述');
    await window.getByRole('button', { name: '5 星' }).click();
    await expect.poll(readMetadataVersion).toBe(versionBeforeRapidEdit + 2);
    await expect(window.getByText('版本冲突', { exact: true })).toHaveCount(0);

    // Search description text (not the filename) so the snippet line adds
    // context instead of duplicating the primary display name.
    await window.getByLabel('搜索资源库').fill('快速连续');
    await window.getByRole('button', { name: '更多', exact: true }).click();
    await window.getByLabel('喜欢过滤').selectOption('yes');
    await window.getByRole('button', { name: '标签', exact: true }).click();
    await window.getByRole('textbox', { name: '标签过滤' }).fill('临时');
    await window.getByRole("option", { name: /临时/ }).click();
    // Search auto-runs on debounce (no 「搜索」 button since c60d890); the
    // auto-search is intentionally silent (Serpent-huvw), so assert on results.
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
    await expect(window.locator('.search-snippet')).toBeVisible();
    await expect(window.locator('.search-snippet mark').first()).toBeVisible();

    // Save the current query as a smart collection via the sidebar inline
    // create; creating auto-opens the settings dialog. Rename it there (仅保存名称)
    // and write the active query (保存当前条件) in the same dialog — the rename
    // menu item reuses this settings dialog.
    await window.getByRole('button', { name: '新建智能合集' }).click();
    await window.getByLabel('新智能合集名称').fill('英雄精选');
    await window.getByLabel('新智能合集名称').press('Enter');
    const smartSettings = window.getByRole('dialog');
    await expect(smartSettings).toBeVisible();
    await smartSettings.getByLabel('名称').fill('英雄精选');
    // Plain Enter follows the shared modal default-action contract; this
    // dialog is intentionally not a form so the host keyboard path is tested.
    await smartSettings.getByLabel('名称').press('Enter');
    await expect(smartSettings).toBeHidden();
    const smartCollectionRow = sidebarSmartCollectionRow(window, '英雄精选');
    await expect(smartCollectionRow).toBeVisible();
    await smartCollectionRow.click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible({ timeout: 10_000 });

    // Rename through the sidebar context menu → the rename dialog (a focused
    // single-field dialog, distinct from the multi-button settings dialog).
    await smartCollectionRow.click({ button: 'right' });
    // The menu is fixed-position but lives under the scrollable app shell.
    // Playwright's normal click may scroll that shell while resolving the
    // target; the menu intentionally dismisses on outside scroll, detaching
    // the item before the click. A forced click models the already-visible
    // pointer action without introducing that synthetic scroll.
    await window.getByRole('menuitem', { name: '重命名智能合集' }).click({ force: true });
    await window.getByRole('dialog').getByLabel('智能合集名称').fill('英雄筛选');
    await window.getByRole('dialog').getByRole('button', { name: '保存名称' }).click();
    await expect(sidebarSmartCollectionRow(window, '英雄筛选')).toBeVisible();

    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
    // Let the smart-collection toast fade so the trash toast below is the
    // current .workspace-notice (the banner is a single reused element).
    await window.waitForFunction(
      () => !document.querySelector('.workspace-notice'),
      { timeout: 10_000 },
    ).catch(() => undefined);
    await locateAssetCard(window, 'hero.png').click({ button: 'right' });
    // Serpent-a711e8: Main delays the real asset.trash IPC request in this
    // E2E-only launch, proving that the visible card disappears before the
    // durable Worker mutation resolves. The frozen preload API is never
    // mutated by the test.
    const deletionStartedAt = Date.now();
    await window.getByRole('menuitem', { name: '移入回收站' }).click();
    await expect(locateAssetCard(window, 'hero.png')).toHaveCount(0, { timeout: 600 });
    expect(Date.now() - deletionStartedAt).toBeLessThan(600);
    await expect(window.locator('.workspace-notice')).toContainText('1 项资产已移入回收站');
    await window.getByRole('button', { name: /回收站/ }).click();
    await locateAssetCard(window, 'hero.png').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '恢复' }).click();
    const restoreDialog = window.getByRole('dialog');
    await window.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]'))
      || document.querySelector('.workspace-notice')?.textContent?.includes('已恢复'));
    if (await restoreDialog.count()) {
      await restoreDialog.getByLabel('恢复位置').selectOption('original');
      await restoreDialog.getByLabel('同名冲突').selectOption('keep-both');
      await restoreDialog.getByRole('button', { name: '确认恢复' }).click();
    }
    await expect(window.locator('.workspace-notice')).toContainText('已恢复 1 项资产');
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(locateAssetCard(window, 'hero.png')).toBeVisible();
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('multi-select performs batch organization, trash, restore, and permanent delete', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-batch-organization-e2e-'));
  const firstSource = path.join(temporaryRoot, 'first.txt');
  const secondSource = path.join(temporaryRoot, 'second.txt');
  writeFileSync(firstSource, 'first');
  writeFileSync(secondSource, 'second');

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
      SERPENT_E2E_IMPORT_FILES: [firstSource, secondSource].join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    const additiveModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill('批量组织验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    // The sidebar no longer creates tags (REQ-TAG-001); seed the tag through
    // the library API, then refresh the sidebar summaries explicitly.
    await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        createTag(input: { libraryId: string; name: string }): Promise<{ ok: boolean }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const created = await api.createTag({ libraryId, name: '批量标签' });
      if (!created.ok) throw new Error('Could not create tag 批量标签');
    });
    await window.getByRole('button', { name: '刷新磁盘变化' }).click();
    await window.getByRole('button', { name: /所有资产/ }).click();
    // Refreshing the library can briefly replace the current result set while
    // the worker reconciles the imported files. Wait for both cards before
    // creating a new scope so the following navigation does not race the
    // refresh response.
    await expect(window.locator('.asset-card')).toHaveCount(2, { timeout: 15_000 });
    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('新建合集').fill('批量合集');
    await window.getByPlaceholder('新建合集').press('Enter');

    // Creating a collection enters the new empty scope; return to all assets
    // before the batch selection.
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2, { timeout: 15_000 });
    await expect(locateAssetCard(window, 'first.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'second.txt')).toBeVisible();

    await locateAssetCard(window, 'first.txt').click();
    await locateAssetCard(window, 'second.txt').click({ modifiers: [additiveModifier] });
    // Right-click on an already-selected asset to open multi-asset context menu
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签…' }).click();
    await window.getByRole('option', { name: '批量标签' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已为 2 项资产添加标签');
    // Re-right-click for next batch operation (menu auto-closes after action)
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加到合集' }).hover();
    await window.getByRole('option', { name: '批量合集' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已将 2 项资产加入合集');

    const counts = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listTags(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ name: string; assetCount: number }> }>;
        listCollections(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ name: string; assetCount: number }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const [tags, collections] = await Promise.all([api.listTags({ libraryId }), api.listCollections({ libraryId })]);
      return {
        tag: tags.value?.find((tag) => tag.name === '批量标签')?.assetCount,
        collection: collections.value?.find((collection) => collection.name === '批量合集')?.assetCount,
      };
    });
    expect(counts).toEqual({ tag: 2, collection: 2 });

    const searchRequestCount = () => window.evaluate(() => (
      globalThis as typeof globalThis & {
        serpent: { e2e: { getRequestCount(type: 'asset.search.request'): number } };
      }
    ).serpent.e2e.getRequestCount('asset.search.request'));
    const tagSearchCount = await searchRequestCount();
    // The sidebar no longer enumerates tags (REQ-TAG-001); enter the
    // tag-filtered view through the retained 标签过滤 entry instead.
    await window.getByRole('button', { name: '标签', exact: true }).click();
    await window.getByRole('textbox', { name: '标签过滤' }).fill('批量标签');
    await window.getByRole("option", { name: /批量标签/ }).click();
    await expect.poll(searchRequestCount).toBeGreaterThan(tagSearchCount);
    await expect(window.getByText('正在同步资源库…')).toHaveCount(0);
    // Flush search-result toast before opening context menu
    await window.waitForFunction(
      () => !document.querySelector('.workspace-notice'),
      { timeout: 10_000 },
    );
    // Multi-select first
    await locateAssetCard(window, 'first.txt').click();
    await locateAssetCard(window, 'second.txt').click({ modifiers: [additiveModifier] });
    // Right-click on first asset to open multi-asset menu
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移除标签…' }).click();
    await window.getByRole('option', { name: '批量标签' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已为 2 项资产移除标签');
    await expect
      .poll(() => window.locator('.asset-card').count(), { timeout: 15_000 })
      .toBe(0);

    await window.getByRole('button', { name: /批量合集/ }).first().click();
    const batchCollectionScopeToggle = window.getByRole('button', {
      name: '包含子合集',
    });
    await batchCollectionScopeToggle.click();
    await expect(batchCollectionScopeToggle).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    const firstMember = locateAssetCard(window, 'first.txt');
    const secondMember = locateAssetCard(window, 'second.txt');
    await firstMember.dragTo(secondMember);
    await expect(window.locator('.workspace-notice')).toContainText('合集成员顺序已更新');
    const memberOrder = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listCollections(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ collectionId: string; name: string }> }>;
        listCollectionAssets(input: { libraryId: string; collectionId: string; recursive: boolean }): Promise<{ ok: boolean; value?: Array<{ displayName: string }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const collections = await api.listCollections({ libraryId });
      const collectionId = collections.value?.find((collection) => collection.name === '批量合集')?.collectionId;
      if (!collectionId) throw new Error('No batch collection');
      const members = await api.listCollectionAssets({ libraryId, collectionId, recursive: false });
      return members.value?.map((asset) => asset.displayName);
    });
    expect(memberOrder).toEqual(['second.txt', 'first.txt']);

    // Delete in a collection scope removes membership, not the underlying
    // asset. This exercises the keyboard path, not only the context menu.
    await firstMember.click();
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+Backspace' : 'Delete');
    await expect(window.locator('.workspace-notice')).toContainText('已将 1 项资产移出合集');
    await expect(locateAssetCard(window, 'first.txt')).toHaveCount(0);
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(locateAssetCard(window, 'first.txt')).toBeVisible();
    const postDeleteCollectionCount = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listCollections(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ name: string; assetCount: number }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const collections = await api.listCollections({ libraryId });
      return collections.value?.find((collection) => collection.name === '批量合集')?.assetCount;
    });
    expect(postDeleteCollectionCount).toBe(1);

    await locateAssetCard(window, 'first.txt').click();
    await locateAssetCard(window, 'second.txt').click({ modifiers: [additiveModifier] });
    // Right-click to open multi-asset context menu
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    const trashMenuItem = window.getByRole('menuitem', {
      name: /移入回收站（2 项）/,
    });
    await expect(trashMenuItem).toBeVisible({ timeout: 15_000 });
    // Electron's test viewport can retain the menu's pre-resize hit box even
    // after its visible surface is clamped; invoke the same DOM action without
    // making the command depend on that transient geometry.
    await trashMenuItem.evaluate((element) => (element as HTMLButtonElement).click());
    await expect(window.locator('.workspace-notice')).toContainText('2 项资产已移入回收站');
    await window.getByRole('button', { name: /回收站/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.locator('.asset-card').first().click({ button: 'right' });
    await window.getByRole('menuitem', { name: /恢复所选（2 项）/ }).click();
    const batchRestoreDialog = window.getByRole('dialog');
    await window.waitForFunction(() => Boolean(document.querySelector('[role="dialog"]'))
      || document.querySelector('.workspace-notice')?.textContent?.includes('已恢复'));
    if (await batchRestoreDialog.count()) {
      await batchRestoreDialog.getByLabel('恢复位置').selectOption('root');
      await batchRestoreDialog.getByLabel('同名冲突').selectOption('skip');
      await batchRestoreDialog.getByRole('button', { name: '确认恢复' }).click();
    }
    await expect(window.locator('.workspace-notice')).toContainText('已恢复 2 项资产');
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await locateAssetCard(window, 'first.txt').click({ button: 'right' });
    await window
      .getByRole('menuitem', { name: /移入回收站（2 项）/ })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect(window.locator('.workspace-notice')).toContainText('2 项资产已移入回收站');
    await window.getByRole('button', { name: /回收站/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.locator('.asset-card').first().click({ button: 'right' });
    await window.getByRole('menuitem', { name: /永久删除（2 项）/ }).click();
    const windowCountBeforeCritical = application.windows().length;
    await expect
      .poll(() => application.windows().length, { timeout: 5_000 })
      .toBeGreaterThan(windowCountBeforeCritical);
    const permanentDeleteWindow = application.windows().at(-1)!;
    await expect(
      permanentDeleteWindow.getByRole('heading', { name: '永久删除这些回收站资产？' }),
    ).toBeVisible();
    await expect(permanentDeleteWindow.locator('button.confirm')).toBeVisible();
    await permanentDeleteWindow
      .getByRole('button', { name: '永久删除', exact: true })
      .click()
      .catch(() => undefined);
    await expect(window.locator('.workspace-notice')).toContainText('已永久删除 2 项');
    await expect(window.locator('.asset-card')).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('critical confirmation windows focus cancel and require red confirmation', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-dialog-focus-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'focus.txt');
  writeFileSync(sourcePath, 'focus target');

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
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill('对话框焦点验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const asset = locateAssetCard(window, 'focus.txt');
    await expect(asset).toBeVisible();

    await asset.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移入回收站' }).click();
    await window.getByRole('button', { name: /回收站/ }).click();
    const trashedAsset = locateAssetCard(window, 'focus.txt');
    await expect(trashedAsset).toBeVisible();
    await trashedAsset.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '永久删除' }).click();
    const windowCountBeforeCritical = application.windows().length;
    await expect
      .poll(() => application.windows().length, { timeout: 5_000 })
      .toBeGreaterThan(windowCountBeforeCritical);
    const criticalWindow = application.windows().at(-1)!;
    await expect(
      criticalWindow.getByRole('heading', { name: '永久删除这些回收站资产？' }),
    ).toBeVisible();
    await expect(
      criticalWindow.getByRole('button', { name: '取消', exact: true }),
    ).toBeFocused();
    await expect(criticalWindow.locator('button.confirm')).toBeVisible();
    await criticalWindow.keyboard.press('Escape').catch(() => undefined);
    await expect.poll(() => criticalWindow.isClosed()).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test('collection recursion toggle immediately refreshes the visible collection scope', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-collection-recursion-e2e-'));
  const childSourcePath = path.join(temporaryRoot, 'child-only.txt');
  const directSourcePath = path.join(temporaryRoot, 'direct-only.txt');
  writeFileSync(childSourcePath, 'child member');
  writeFileSync(directSourcePath, 'direct member');

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
      SERPENT_E2E_IMPORT_FILES: [childSourcePath, directSourcePath].join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole("textbox", { name: "名称" }).fill('合集递归验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(locateAssetCard(window, 'child-only.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'direct-only.txt')).toBeVisible();

    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('新建合集').fill('父合集');
    await window.getByPlaceholder('新建合集').press('Enter');
    await collectionRow(window, '父合集').click();
    await window.getByRole('button', { name: '添加合集' }).click();
    await expect(window.getByPlaceholder('新建合集')).toBeFocused();
    await window.getByPlaceholder('新建合集').fill('子合集');
    await window.getByPlaceholder('新建合集').press('Enter');
    const parentCollectionRow = window
      .locator('.nav-row')
      .filter({ hasText: '父合集' })
      .first();
    await expect(parentCollectionRow.locator('.nav-count')).toHaveText('0');
    await expect(parentCollectionRow.locator('.nav-child-count')).toHaveCount(0);

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('新建合集').fill('空合集');
    await window.getByPlaceholder('新建合集').press('Enter');
    // Creating a collection enters the new empty scope; return to all assets
    // before assigning both members.
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(locateAssetCard(window, 'child-only.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'direct-only.txt')).toBeVisible();
    // Import auto-selects every imported asset (reveal), so right-clicking one
    // card would open the multi-asset menu and add the whole selection. Click
    // the canvas background first to reset the selection to the single target.
    await window.locator('.workspace-canvas').click({ position: { x: 8, y: 8 } });
    await locateAssetCard(window, 'child-only.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加到合集' }).hover();
    await window.getByRole('option', { name: '子合集' }).click();
    await window.locator('.workspace-canvas').click({ position: { x: 8, y: 8 } });
    await locateAssetCard(window, 'direct-only.txt').click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加到合集' }).hover();
    await window.getByRole('option', { name: '父合集' }).click();
    const collectionState = await window.evaluate(async () => {
      const api = (globalThis as typeof globalThis & { serpent: { library: {
        listOpen(): Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }>;
        listCollections(input: { libraryId: string }): Promise<{ ok: boolean; value?: Array<{ collectionId: string; parentId: string | null; name: string }> }>;
        listCollectionAssets(input: { libraryId: string; collectionId: string; recursive: boolean }): Promise<{ ok: boolean; value?: Array<{ displayName: string }> }>;
      } } }).serpent.library;
      const open = await api.listOpen();
      const libraryId = open.value?.[0]?.libraryId;
      if (!libraryId) throw new Error('No open library');
      const collections = await api.listCollections({ libraryId });
      const parent = collections.value?.find((collection) => collection.name === '父合集');
      const child = collections.value?.find((collection) => collection.name === '子合集');
      if (!parent || !child) throw new Error('Missing collection hierarchy');
      const direct = await api.listCollectionAssets({
        libraryId,
        collectionId: parent.collectionId,
        recursive: false,
      });
      return { childParentId: child.parentId, directNames: direct.value?.map((asset) => asset.displayName), parentId: parent.collectionId };
    });
    expect(collectionState.childParentId).toBe(collectionState.parentId);
    expect(collectionState.directNames).toEqual(['direct-only.txt']);
    await collectionRow(window, '父合集').click();
    await expect(locateAssetCard(window, 'child-only.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'direct-only.txt')).toBeVisible();

    const additiveModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await locateAssetCard(window, 'child-only.txt').click();
    await locateAssetCard(window, 'direct-only.txt').click({ modifiers: [additiveModifier] });
    // Right-click on the first selected asset for multi-asset menu
    await locateAssetCard(window, 'child-only.txt').click({ button: 'right' });
    // Mixed membership: both add and remove stay available (REQ-MENU-007 skip path).
    await expect(window.getByRole('menuitem', { name: '从合集移除' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: '添加到合集' })).toBeVisible();
    await window.getByRole('menuitem', { name: '从合集移除' }).hover();
    await window.getByRole('option', { name: '父合集' }).click();
    await expect(window.locator('.workspace-notice')).toContainText('已将 1 项直接成员移出合集；1 项不是该合集的直接成员，未改动');
    await expect(locateAssetCard(window, 'child-only.txt')).toBeVisible();
    await expect(locateAssetCard(window, 'direct-only.txt')).toHaveCount(0);

    // CU-B4: non-member of 父合集 must not see remove-from-parent (only add).
    await locateAssetCard(window, 'child-only.txt').click({ button: 'right' });
    await expect(window.getByRole('menuitem', { name: '添加到合集' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: '从合集移除' })).toBeVisible();
    await window.getByRole('menuitem', { name: '添加到合集' }).hover();
    await expect(window.getByRole('option', { name: '父合集' })).toBeVisible();
    await window.getByRole('menuitem', { name: '从合集移除' }).hover();
    await expect(window.getByRole('option', { name: '子合集' })).toBeVisible();
    await window.keyboard.press('Escape');

    await window.getByRole('button', { name: /所有资产/ }).click();
    // CU-B4: empty collection → add only; remove hidden for non-members.
    await locateAssetCard(window, 'direct-only.txt').click({ button: 'right' });
    await expect(window.getByRole('menuitem', { name: '添加到合集' })).toBeVisible();
    await expect(window.getByRole('menuitem', { name: '从合集移除' })).toHaveCount(0);
    await window.getByRole('menuitem', { name: '添加到合集' }).hover();
    await expect(window.getByRole('option', { name: '空合集' })).toBeVisible();
    await window.keyboard.press('Escape');

    await collectionRow(window, '父合集').click();

    const parentCollectionScopeToggle = window.getByRole('button', {
      name: '包含子合集',
    });
    await parentCollectionScopeToggle.click();
    await expect(parentCollectionScopeToggle).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(locateAssetCard(window, 'child-only.txt')).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
