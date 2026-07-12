import { _electron as electron, expect, test } from '@playwright/test';

test('the packaged application starts with an isolated renderer', async () => {
  const executablePath = process.env.SERPENT_E2E_PACKAGED_EXECUTABLE;
  if (!executablePath) {
    throw new Error('Set SERPENT_E2E_PACKAGED_EXECUTABLE after packaging.');
  }

  const application = await electron.launch({
    executablePath,
    args: [],
  });

  try {
    const window = await application.firstWindow();
    await expect(window.getByRole('heading', { name: '从一个本地资源库开始' })).toBeVisible();
    expect(
      await window.evaluate(() => ({
        hasNodeProcess: typeof globalThis.process !== 'undefined',
        hasRequire: typeof globalThis.require !== 'undefined',
      })),
    ).toEqual({ hasNodeProcess: false, hasRequire: false });

    const screenshotPath = test.info().outputPath('packaged-empty-state.png');
    await window.screenshot({ path: screenshotPath });
    await test.info().attach('packaged-empty-state', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  } finally {
    await application.close();
  }
});
