import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import sharp from 'sharp';

import { resolveOiiotoolPath } from '../../src/worker/binary-resolver';
import { assetCard, electronLaunchEnv, openLinkedFolderImportMenu, resolveElectronExecutablePath, waitForLibraryLoadingToFinish } from './electron-test-helpers';

async function quit(application: ElectronApplication): Promise<void> {
  const child = application.process();
  const exited = child.exitCode === null ? once(child, 'exit').then(() => undefined) : Promise.resolve();
  await application.evaluate(({ app }) => app.quit()).catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, 5_000); })]);
  clearTimeout(timer);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
  await application.close().catch(() => undefined);
}

async function expectDecoded(window: Page, name: string): Promise<void> {
  const image = assetCard(window, name).locator('img.asset-thumbnail').first();
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => image.evaluate((element) => element instanceof HTMLImageElement
    && element.complete && element.naturalWidth > 0 && element.naturalHeight > 0), { timeout: 30_000 }).toBe(true);
}

test('decodes direct JPG and # TGA previews with 4k linked directories, and retains empty folders after process restart offline', async () => {
  test.setTimeout(180_000);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-linked-#-preview-'));
  const sourceRoot = path.join(temporaryRoot, '#source');
  const libraryName = 'LinkedPreview';
  const libraryPath = path.join(temporaryRoot, libraryName);
  let application: ElectronApplication | undefined;
  try {
    mkdirSync(sourceRoot);
    for (let group = 0; group < 100; group += 1) {
      for (let child = 0; child < 40; child += 1) {
        mkdirSync(path.join(sourceRoot, 'empty', `group-${group}`, `child-${child}`), { recursive: true });
      }
    }
    await sharp({ create: { width: 480, height: 480, channels: 3, background: { r: 42, g: 108, b: 174 } } })
      .jpeg().toFile(path.join(sourceRoot, 'direct.jpg'));
    execFileSync(resolveOiiotoolPath(), ['--wildcardoff', '--pattern', 'checker', '32x16', '3', '-o', path.join(sourceRoot, 'derived.tga')]);
    const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
    const launch = () => electron.launch({
      args: [applicationDirectory], cwd: applicationDirectory, executablePath: resolveElectronExecutablePath(),
      env: electronLaunchEnv({
        SERPENT_E2E: '1', SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
        SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
        SERPENT_E2E_OPEN_LIBRARY_PATH: libraryPath,
        SERPENT_E2E_LINKED_SOURCE: sourceRoot,
      }),
    });
    application = await launch();
    let window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await waitForLibraryLoadingToFinish(window);
    await openLinkedFolderImportMenu(application, window);
    await window.getByRole('button', { name: '#source', exact: true }).first().click({ timeout: 30_000 });
    await expectDecoded(window, 'direct.jpg');
    await expectDecoded(window, 'derived.tga');
    await assetCard(window, 'direct.jpg').locator('img.asset-thumbnail').first().click();
    await window.keyboard.press('Space');
    const viewer = window.getByRole('region', { name: 'direct.jpg 查看页面' });
    const viewerImage = viewer.locator('img.preview-image:not(.is-hidden)');
    await expect(viewerImage).toBeVisible();
    await expect.poll(() => viewerImage.evaluate((element) => element instanceof HTMLImageElement
      && element.complete && element.naturalWidth === 480 && element.naturalHeight === 480)).toBe(true);
    await expect(viewerImage).toHaveAttribute('src', /^serpent:\/\/source\//u);
    await window.keyboard.press('Escape');
    await quit(application);
    application = undefined;
    renameSync(sourceRoot, path.join(temporaryRoot, 'unavailable-source'));
    application = await launch();
    window = await application.firstWindow();
    await window.getByRole('button', { name: '打开资源库', exact: true }).click();
    await expect(window.getByRole('button', { name: '#source', exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await waitForLibraryLoadingToFinish(window);
    await window.getByRole('button', { name: '#source', exact: true }).first().click();
    await expect(window.getByRole('button', { name: 'empty', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    if (application) await quit(application);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
