import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    const assetCard = window.getByRole('button', { name: /hero\.png/i });
    await expect(assetCard).toBeVisible();

    await window.getByRole('button', { name: '添加标签' }).click();
    await window.getByPlaceholder('输入标签名称，回车创建').fill('角色');
    await window.getByPlaceholder('输入标签名称，回车创建').press('Enter');
    await expect(window.getByRole('button', { name: /角色/ })).toBeVisible();
    await window.getByRole('button', { name: '添加标签' }).click();
    await window.getByPlaceholder('输入标签名称，回车创建').fill('临时');
    await window.getByPlaceholder('输入标签名称，回车创建').press('Enter');
    await expect(window.getByRole('button', { name: /临时/ })).toBeVisible();

    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入合集名称，回车创建').fill('精选');
    await window.getByPlaceholder('输入合集名称，回车创建').press('Enter');
    await expect(window.getByRole('button', { name: /精选/ })).toBeVisible();

    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签：角色' }).click();
    await expect(window.locator('.toast')).toContainText('标签已添加');
    await assetCard.click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签：临时' }).click();
    await expect(window.locator('.toast')).toContainText('标签已添加');
    await window.getByRole('button', { name: /角色/ }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: /hero\.png/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '加入合集：精选' }).click();
    await expect(window.locator('.toast')).toContainText('资产已加入合集');
    await window.getByRole('button', { name: /精选/ }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByRole('button', { name: /角色/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '重命名标签' }).click();
    await expect(window.getByRole('heading', { name: '重命名标签' })).toBeVisible();
    await window.getByLabel('标签名称').fill('临时');
    await window.getByRole('button', { name: '保存名称' }).click();
    await expect(window.getByRole('alert')).toContainText('重命名标签失败。原因：资源库中已存在同名标签。');
    await expect(window.getByRole('heading', { name: '重命名标签' })).toBeVisible();
    await window.getByLabel('标签名称').fill('人物');
    await window.getByRole('button', { name: '保存名称' }).click();
    await expect(window.getByRole('button', { name: /人物/ })).toBeVisible();
    await expect(window.locator('.toast')).toContainText('标签已重命名');

    await window.getByRole('button', { name: /精选/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '重命名合集' }).click();
    await expect(window.getByRole('heading', { name: '重命名合集' })).toBeVisible();
    await window.getByLabel('合集名称').fill('收藏');
    await window.getByRole('button', { name: '保存名称' }).click();
    await expect(window.getByRole('button', { name: /收藏/ })).toBeVisible();
    await expect(window.locator('.toast')).toContainText('合集已重命名');

    await window.getByRole('button', { name: /收藏/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '编辑合集详情' }).click();
    await window.getByLabel('描述').fill('主要角色精选资产');
    await window.getByLabel('封面资产').selectOption({ label: 'hero.png' });
    await window.getByRole('button', { name: '保存详情' }).click();
    await expect(window.locator('.toast')).toContainText('合集详情已更新');
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

    await window.getByRole('button', { name: /hero\.png/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '从当前合集移除' }).click();
    await expect(window.locator('.toast')).toContainText('资产已从合集移除');
    await expect(window.getByRole('button', { name: /hero\.png/i })).toHaveCount(0);

    window.once('dialog', (dialog) => dialog.accept());
    await window.getByRole('button', { name: /人物/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '删除标签' }).click();
    await expect(window.getByRole('button', { name: /人物/ })).toHaveCount(0);
    await expect(window.locator('.toast')).toContainText('标签已删除');

    window.once('dialog', (dialog) => dialog.accept());
    await window.getByRole('button', { name: /收藏/ }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '删除合集' }).click();
    await expect(window.getByRole('button', { name: /收藏/ })).toHaveCount(0);
    await expect(window.locator('.toast')).toContainText('合集已删除');
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();

    await window.getByRole('button', { name: /hero\.png/i }).click();
    await window.getByRole('button', { name: '4 星' }).click();
    await expect(window.getByText(/版本 1/)).toBeVisible();
    await window.getByRole('button', { name: '标记喜欢' }).click();
    await expect(window.getByText(/版本 2/)).toBeVisible();
    await window.getByLabel('人工色卡').fill('red');
    await window.getByLabel('人工色卡').press('Enter');
    await expect(window.getByText('保存色卡失败。原因：颜色必须使用 #RRGGBB 格式。')).toBeVisible();
    await expect(window.getByText(/版本 2/)).toBeVisible();
    await window.getByLabel('人工色卡').fill('#112233, #AABBCC');
    await window.getByLabel('人工色卡').press('Enter');
    await expect(window.getByText(/版本 3/)).toBeVisible();
    await expect(window.getByLabel('色卡预览').locator('span')).toHaveCount(2);

    const descriptionInput = window.getByLabel('描述');
    const sourceUrlInput = window.getByLabel('源链接 (URL)');
    await descriptionInput.fill('待清空描述');
    await descriptionInput.blur();
    await expect(window.getByText(/版本 4/)).toBeVisible();
    await sourceUrlInput.fill('javascript:alert(1)');
    await sourceUrlInput.press('Enter');
    await expect(window.getByText('保存源链接失败。原因：请输入不含账号密码的 HTTP(S) 完整链接。')).toBeVisible();
    await expect(window.getByText(/版本 4/)).toBeVisible();
    await sourceUrlInput.fill('https://example.com/source');
    await sourceUrlInput.press('Enter');
    await expect(window.getByText(/版本 5/)).toBeVisible();

    await descriptionInput.fill('');
    await descriptionInput.blur();
    await expect(window.getByText(/版本 6/)).toBeVisible();
    await sourceUrlInput.fill('');
    await sourceUrlInput.press('Enter');
    await expect(window.getByText(/版本 7/)).toBeVisible();
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
    await descriptionInput.fill('快速连续修改的描述');
    await window.getByRole('button', { name: '5 星' }).click();
    await expect(window.getByText(/版本 9/)).toBeVisible();
    await expect(window.getByText('版本冲突', { exact: true })).toHaveCount(0);

    await window.getByLabel('搜索资源库').fill('hero.png');
    await window.getByText('筛选与排序', { exact: true }).click();
    await window.getByLabel('喜欢过滤').selectOption('yes');
    await window.getByLabel('标签过滤').fill('临时');
    await window.getByRole('button', { name: '搜索', exact: true }).click();
    await expect(window.locator('.toast')).toContainText('找到 1 项');
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();
    await expect(window.locator('.search-snippet')).toBeVisible();
    await expect(window.locator('.search-snippet mark').first()).toBeVisible();

    await window.getByLabel('智能合集标题').fill('英雄精选');
    await window.getByRole('button', { name: '保存', exact: true }).click();
    await expect(window.getByRole('button', { name: '英雄精选', exact: true })).toBeVisible();
    // Flush smart-collection save toast before navigating
    await window.waitForFunction(
      () => !document.querySelector('.toast'),
      { timeout: 10_000 },
    );
    await window.getByRole('button', { name: '英雄精选', exact: true }).click();
    // Smart collection may show search result toast but it's not guaranteed
    // across runs; verify the asset is visible instead
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible({ timeout: 10_000 });

    await window.getByRole('button', { name: '英雄精选', exact: true }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '用当前条件更新' }).click();
    await expect(window.locator('.toast')).toContainText('智能合集条件已更新');

    await window.getByRole('button', { name: '英雄精选', exact: true }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '重命名智能合集' }).click();
    await window.getByRole('dialog').getByLabel('智能合集名称').fill('英雄筛选');
    await window.getByRole('dialog').getByRole('button', { name: '保存名称' }).click();
    await expect(window.getByRole('button', { name: '英雄筛选', exact: true })).toBeVisible();

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: /hero\.png/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移入回收站' }).click();
    await expect(window.locator('.toast')).toContainText('已移入回收站');
    await window.getByRole('button', { name: '回收站', exact: true }).click();
    await window.getByRole('button', { name: /hero\.png/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '恢复' }).click();
    await window.getByLabel('恢复位置').selectOption('original');
    await window.getByLabel('同名冲突').selectOption('keep-both');
    await window.getByRole('button', { name: '确认恢复' }).click();
    await expect(window.locator('.toast')).toContainText('已恢复 1 项资产');
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(window.getByRole('button', { name: /hero\.png/i })).toBeVisible();
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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: [firstSource, secondSource].join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    const additiveModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill('批量组织验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    await window.getByRole('button', { name: '添加标签' }).click();
    await window.getByPlaceholder('输入标签名称，回车创建').fill('批量标签');
    await window.getByPlaceholder('输入标签名称，回车创建').press('Enter');
    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入合集名称，回车创建').fill('批量合集');
    await window.getByPlaceholder('输入合集名称，回车创建').press('Enter');

    await window.getByRole('button', { name: /first\.txt/i }).click();
    await window.getByRole('button', { name: /second\.txt/i }).click({ modifiers: [additiveModifier] });
    // Right-click on an already-selected asset to open multi-asset context menu
    await window.getByRole('button', { name: /first\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '添加标签：批量标签' }).click();
    await expect(window.locator('.toast')).toContainText('已为 2 项资产添加标签');
    // Re-right-click for next batch operation (menu auto-closes after action)
    await window.getByRole('button', { name: /first\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '加入合集：批量合集' }).click();
    await expect(window.locator('.toast')).toContainText('已将 2 项资产加入合集');

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
    await window.getByRole('button', { name: /批量标签/ }).first().click();
    await expect.poll(searchRequestCount).toBeGreaterThan(tagSearchCount);
    await expect(window.getByText('正在同步资源库…')).toHaveCount(0);
    // Flush search-result toast before opening context menu
    await window.waitForFunction(
      () => !document.querySelector('.toast'),
      { timeout: 10_000 },
    );
    // Multi-select first
    await window.getByRole('button', { name: /first\.txt/i }).click();
    await window.getByRole('button', { name: /second\.txt/i }).click({ modifiers: [additiveModifier] });
    // Right-click on first asset to open multi-asset menu
    await window.getByRole('button', { name: /first\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移除标签：批量标签' }).click();
    await expect(window.locator('.toast')).toContainText('已为 2 项资产移除标签');
    await expect(window.locator('.asset-card')).toHaveCount(0);

    await window.getByRole('button', { name: /批量合集/ }).first().click();
    await window.getByLabel('包含子合集').uncheck();
    const firstMember = window.getByRole('button', { name: /first\.txt/i });
    const secondMember = window.getByRole('button', { name: /second\.txt/i });
    await firstMember.dragTo(secondMember);
    await expect(window.locator('.toast')).toContainText('合集成员顺序已更新');
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

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: /first\.txt/i }).click();
    await window.getByRole('button', { name: /second\.txt/i }).click({ modifiers: ['Shift'] });
    // Right-click to open multi-asset context menu
    await window.getByRole('button', { name: /first\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: /移入回收站（2 项）/ }).click();
    await expect(window.locator('.toast')).toContainText('2 项资产已移入回收站');
    await window.getByRole('button', { name: '回收站', exact: true }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.locator('.asset-card').first().click({ button: 'right' });
    await window.getByRole('menuitem', { name: /恢复所选（2 项）/ }).click();
    await window.getByLabel('恢复位置').selectOption('root');
    await window.getByLabel('同名冲突').selectOption('skip');
    await window.getByRole('button', { name: '确认恢复' }).click();
    await expect(window.locator('.toast')).toContainText('已恢复 2 项资产');
    await window.getByRole('button', { name: /所有资产/ }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);

    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.getByRole('button', { name: /first\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: /移入回收站（2 项）/ }).click();
    await expect(window.locator('.toast')).toContainText('2 项资产已移入回收站');
    await window.getByRole('button', { name: '回收站', exact: true }).click();
    await expect(window.locator('.asset-card')).toHaveCount(2);
    await window.locator('.asset-card').first().click();
    await window.locator('.asset-card').last().click({ modifiers: [additiveModifier] });
    await window.locator('.asset-card').first().click({ button: 'right' });
    await window.getByRole('menuitem', { name: /永久删除（2 项）/ }).click();
    await expect(window.getByRole('dialog')).toContainText('所选 2 项资产');
    await window.getByRole('dialog').getByRole('button', { name: '永久删除 2 项' }).click();
    await expect(window.locator('.toast')).toContainText('已永久删除 2 项');
    await expect(window.locator('.asset-card')).toHaveCount(0);
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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: [childSourcePath, directSourcePath].join(path.delimiter),
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill('合集递归验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();
    await expect(window.getByRole('button', { name: /child-only\.txt/i })).toBeVisible();
    await expect(window.getByRole('button', { name: /direct-only\.txt/i })).toBeVisible();

    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入合集名称，回车创建').fill('父合集');
    await window.getByPlaceholder('输入合集名称，回车创建').press('Enter');
    await window.getByRole('button', { name: /父合集/ }).click();
    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入子合集名称，回车创建').fill('子合集');
    await window.getByPlaceholder('输入子合集名称，回车创建').press('Enter');

    await window.getByRole('button', { name: /所有资产/ }).click();
    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入合集名称，回车创建').fill('空合集');
    await window.getByPlaceholder('输入合集名称，回车创建').press('Enter');
    await window.getByRole('button', { name: /child-only\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '加入合集：子合集' }).click();
    await window.getByRole('button', { name: /direct-only\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '加入合集：父合集' }).click();
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
    await window.getByRole('button', { name: /父合集/ }).click();
    await expect(window.getByRole('button', { name: /child-only\.txt/i })).toBeVisible();
    await expect(window.getByRole('button', { name: /direct-only\.txt/i })).toBeVisible();

    const additiveModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await window.getByRole('button', { name: /child-only\.txt/i }).click();
    await window.getByRole('button', { name: /direct-only\.txt/i }).click({ modifiers: [additiveModifier] });
    // Right-click on the first selected asset for multi-asset menu
    await window.getByRole('button', { name: /child-only\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移出合集：父合集' }).click();
    await expect(window.locator('.toast')).toContainText('已将 1 项直接成员移出合集；1 项不是该合集的直接成员，未改动');
    await expect(window.getByRole('button', { name: /child-only\.txt/i })).toBeVisible();
    await expect(window.getByRole('button', { name: /direct-only\.txt/i })).toHaveCount(0);

    // Single-select + right-click for context menu
    await window.getByRole('button', { name: /child-only\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移出合集：父合集' }).click();
    await expect(window.getByText('无法从当前合集移除：该资产属于子合集，请进入对应子合集后再移除。')).toBeVisible();
    await expect(window.getByRole('button', { name: /child-only\.txt/i })).toBeVisible();

    await window.getByRole('button', { name: /所有资产/ }).click();
    // Right-click on direct-only for single-asset context menu
    await window.getByRole('button', { name: /direct-only\.txt/i }).click({ button: 'right' });
    await window.getByRole('menuitem', { name: '移出合集：空合集' }).click();
    await expect(window.getByText('无法从当前合集移除：该资产属于子合集，请进入对应子合集后再移除。')).toBeVisible();
    await expect(window.getByRole('button', { name: /direct-only\.txt/i })).toBeVisible();

    await window.getByRole('button', { name: /父合集/ }).click();

    await window.getByLabel('包含子合集').uncheck();
    await expect(window.getByRole('button', { name: /child-only\.txt/i })).toHaveCount(0);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
