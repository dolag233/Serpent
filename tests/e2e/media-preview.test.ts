import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

test('video preview reports a specific generation failure and persists its diagnostic', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-media-preview-e2e-'));
  const sourcePath = path.join(temporaryRoot, 'broken-preview.mp4');
  const missingFfmpegPath = path.join(temporaryRoot, 'missing-tools', 'ffmpeg');
  const libraryName = '视频预览错误验收';
  const libraryPath = path.join(temporaryRoot, libraryName);
  writeFileSync(sourcePath, Buffer.from('intentionally-not-a-video'));

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: {
      ...process.env,
      SERPENT_E2E: '1',
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_IMPORT_FILES: sourcePath,
      SERPENT_FFMPEG_PATH: missingFfmpegPath,
    },
  });

  try {
    const window = await application.firstWindow();
    const logsPath = await application.evaluate(({ app }) => app.getPath('logs'));
    const logPath = path.join(logsPath, 'serpent.log');
    const initialLogLength = existsSync(logPath) ? readFileSync(logPath).byteLength : 0;
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByLabel('名称').fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    await window.getByRole('button', { name: '导入文件', exact: true }).first().click();

    const assetCard = window.getByRole('button').filter({ hasText: 'broken-preview.mp4' });
    await expect(assetCard).toBeVisible();
    await assetCard.dblclick();

    const preview = window.getByRole('dialog', { name: 'broken-preview.mp4 预览' });
    await expect(preview).toBeVisible();
    await expect(preview.getByText('预览不可用')).toBeVisible();
    await preview.getByRole('button', { name: '重试生成' }).click();
    await expect(preview.getByText(/缺少 FFmpeg|媒体处理失败|源文件可能损坏/)).toBeVisible({
      timeout: 15_000,
    });

    await expect.poll(() => existsSync(logPath)
      ? readFileSync(logPath).subarray(initialLogLength).toString('utf8')
      : '').toMatch(
      /FFMPEG_REQUIRED|MEDIA_PROCESSING_FAILED/,
    );
    expect(readFileSync(logPath).subarray(initialLogLength).toString('utf8')).toContain('worker.thumbnail-queue');
    expect(existsSync(libraryPath)).toBe(true);
  } finally {
    await application.close();
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});
