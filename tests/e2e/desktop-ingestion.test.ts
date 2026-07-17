import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_CLIPBOARD_IMAGE_PATH: clipboardSource,
      SERPENT_E2E_CLIPBOARD_NOW: '2026-07-13T12:34:56.000Z',
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '添加文件夹' }).click();
    await window.getByLabel("新文件夹名称").fill('项目');
    await window.keyboard.press("Enter");
    await window.getByRole('button', { name: '项目' }).click();

    await window.getByRole('button', { name: '添加合集' }).click();
    await window.getByPlaceholder('输入合集名称，回车创建').fill('情绪板');
    await window.getByPlaceholder('输入合集名称，回车创建').press('Enter');
    await window.getByRole('button', { name: '情绪板' }).click();

    await window.getByRole('button', { name: '粘贴图片' }).click();
    await expect(window.getByText('Clipboard 2026-07-13T12-34-56Z.png', { exact: true })).toBeVisible();

    const projectDirectory = path.join(libraryPath, 'Assets', '项目');
    const importedNames = readdirSync(projectDirectory).filter((name) => /^Clipboard .*\.png$/.test(name));
    expect(importedNames).toHaveLength(1);
    expect(existsSync(path.join(projectDirectory, importedNames[0]!))).toBe(true);

    // A second paste deterministically enters the existing conflict flow. The
    // pending opaque import keeps its collection destination until resolution.
    await window.getByRole('button', { name: '粘贴图片' }).click();
    const conflictDialog = window.getByRole('dialog');
    await expect(conflictDialog.getByRole('heading', { name: '处理导入冲突' })).toBeVisible();
    await conflictDialog.getByLabel('疑似重复').selectOption('create-copy');
    await conflictDialog.getByRole('button', { name: '应用并导入' }).click();
    await expect(conflictDialog).toBeHidden();
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
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_CLIPBOARD_IMAGE_PATH: invalidClipboardSource,
    },
  });

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill('桌面导入错误验收');
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '粘贴图片' }).click();
    await expect(window.getByRole('alert')).toContainText('系统剪贴板中没有可导入的图片');

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
