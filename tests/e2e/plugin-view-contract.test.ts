import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { _electron as electron, expect, test, type Frame } from '@playwright/test';

import { resolveElectronExecutablePath, electronLaunchEnv } from './electron-test-helpers';

test.describe.configure({ timeout: 120_000 });

/**
 * Host-managed plugin view contract E2E (Serpent-ex46.7):
 *  - the host announces view-mounted on document load and the plugin confirms
 *    ready with viewType/scope;
 *  - theme changes propagate as theme-changed WITHOUT reloading (ready stays 1);
 *  - reloading the document re-enters the handshake (ready/mounted count up);
 *  - closing the library unmounts the view (view-unmounted reaches the plugin);
 *  - a second library gets its own mounted instance (libraryId differs).
 */
test('plugin view contract: mount, theme-without-reload, reload, unmount, library isolation', async (
  // eslint-disable-next-line no-empty-pattern -- no Playwright fixtures needed
  {},
  testInfo,
) => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-view-contract-e2e-'));
  const libraryOne = '视图契约库一';
  const libraryTwo = '视图契约库二';
  const pluginDirectory = path.join(temporaryRoot, 'view-contract-probe');
  const packageDirectory = path.join(pluginDirectory, 'package');
  const fixture = path.join(process.cwd(), 'tests', 'fixtures', 'plugins', 'view-contract-probe');

  // The plugin package is served from a temp copy (the fixture dir must not
  // be mutated by install/sync bookkeeping).
  cpSync(fixture, packageDirectory, { recursive: true });

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const application = await electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_E2E_USER_DATA_PATH: path.join(temporaryRoot, 'user-data'),
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_PLUGIN_PACKAGE: packageDirectory,
    }),
  });
  // Collect main-process stderr so an install failure leaves a trail.
  const mainStderr: string[] = [];
  application.process().stderr?.on('data', (chunk: Buffer) => {
    mainStderr.push(chunk.toString());
  });
  // Diagnose the main process environment: userData/logs isolation and the
  // E2E env vars must be visible inside the Electron process.
  const mainDiag = await application.evaluate(({ app }) => ({
    userData: app.getPath('userData'),
    logs: app.getPath('logs'),
    e2e: process.env.SERPENT_E2E,
    e2eUserData: process.env.SERPENT_E2E_USER_DATA_PATH,
  })).catch(() => null);
  console.log('MAIN-DIAG', JSON.stringify(mainDiag));

  function probeFrame(): Frame | null {
    for (const window of application.windows()) {
      const frame = window.frames().find(
        (candidate) => candidate.url().includes('serpent-plugin://') && candidate.url().includes('view-contract-probe'),
      );
      if (frame !== undefined) return frame;
    }
    return null;
  }

  async function openSidebarView(window: Awaited<ReturnType<typeof application.firstWindow>>) {
    await window.getByRole('button', { name: 'View contract probe' }).click();
    const panel = window.locator('.plugin-sidebar-view-panel');
    await expect(panel).toBeVisible();
    try {
      await expect.poll(() => probeFrame()?.url() ?? '', { timeout: 30_000 }).toContain('serpent-plugin://');
    } catch (error) {
      const panelHtml = await panel.evaluate((element) => element.innerHTML).catch(() => 'unavailable');
      const frameUrls = application.windows()
        .flatMap((w) => w.frames())
        .map((f) => f.url())
        .filter((url) => url.length > 0);
      console.log('PANEL-HTML', panelHtml.slice(0, 800));
      console.log('ALL-FRAME-URLS', JSON.stringify(frameUrls));
      throw error;
    }
    const frame = probeFrame();
    expect(frame).not.toBeNull();
    return frame as Frame;
  }

  try {
    const window = await application.firstWindow();

    // --- Install the probe plugin in library scope ---
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryOne);
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '设置' }).click();
    const settingsDialog = window.getByRole('dialog', { name: '通用设置' });
    await settingsDialog.getByRole('tab', { name: '插件' }).click();
    await settingsDialog.getByRole('button', { name: '安装插件' }).click();
    const installDialog = window.getByRole('dialog', { name: '安装插件' });
    await installDialog.getByLabel('安装范围').selectOption('library');
    const installButton = installDialog.getByRole('button', { name: '本地安装' });
    await expect(installButton).toBeEnabled();
    await installButton.click();
    // Surface the install error (if any) instead of timing out blindly.
    // textContent() waits up to its timeout for the element — the dialog may
    // close on success, so probe with a short timeout to keep the poll fast.
    const installErrorLocator = installDialog.locator('.plugin-settings-error');
    try {
      await expect.poll(async () => {
        const error = (await installErrorLocator.count()) > 0
          ? await installErrorLocator.textContent({ timeout: 500 }).catch(() => null)
          : null;
        if (error !== null && error !== undefined && error.trim() !== '') return `error: ${error.trim()}`;
        const dialogVisible = await installDialog.isVisible().catch(() => false);
        const nameCount = await settingsDialog.getByText(/View Contract Probe\s*-\s*v/).count().catch(() => 0);
        if (nameCount > 0) return 'installed';
        return dialogVisible ? 'pending' : 'dialog-closed-without-install';
      }, { timeout: 30_000 }).toBe('installed');
    } catch (error) {
      // Dump the main-process log — the install path logs every rejection.
      const { readFileSync, existsSync } = await import('node:fs');
      const logPath = path.join(temporaryRoot, 'user-data', 'logs', 'serpent.log');
      if (existsSync(logPath)) {
        console.log(`INSTALL-LOG:\n${readFileSync(logPath, 'utf8')}`);
      }
      throw error;
    }
    await settingsDialog.getByRole('button', { name: '信任', exact: true }).click();
    // Activation is asynchronous (Host start + contribution refresh); wait for
    // the enable toggle to become active before leaving the dialog — a 5s
    // budget (as in the palette-tools baseline) is too tight here.
    const enableToggle = settingsDialog
      .locator('.plugin-settings-scope-card')
      .filter({ hasText: '资源库插件' })
      .getByRole('checkbox', { name: '启用插件' });
    await expect(enableToggle).toBeEnabled({ timeout: 30_000 });
    await expect(enableToggle).toBeChecked();
    await settingsDialog.press('Escape');
    // Reopening the settings dialog changes the contribution refresh key, so
    // the sidebar contribution list reloads even if the change notification
    // was missed — this distinguishes a stale renderer from missing publish.
    await window.getByRole('button', { name: '设置' }).click();
    await window.getByRole('dialog', { name: '通用设置' }).getByRole('tab', { name: '插件' }).click();
    await window.getByRole('dialog', { name: '通用设置' }).press('Escape');

    // --- Mount: host announces view-mounted, plugin confirms ready ---
    await openSidebarView(window);
    // The frame may be rebuilt once while the library context settles (the
    // host keys frames by contribution+scope+library); always probe the live
    // frame instead of caching one.
    async function liveFrameCounts(): Promise<{
      counts: { mounted: number; ready: number; themeChanged: number };
      mountedPayload: { viewType?: string; scope?: string; libraryId?: string } | null;
    } | null> {
      const frame = probeFrame();
      if (frame === null) return null;
      return frame.evaluate(() => ({
        counts: (window as unknown as { __viewContractCounts?: { mounted: number; ready: number; themeChanged: number } })
          .__viewContractCounts ?? { mounted: 0, ready: 0, themeChanged: 0 },
        mountedPayload: (window as unknown as {
          __viewContractMountedPayload?: { viewType?: string; scope?: string; libraryId?: string } | null;
        }).__viewContractMountedPayload ?? null,
      })).catch(() => null);
    }
    await expect.poll(async () => (await liveFrameCounts())?.counts.mounted ?? 0, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    const mounted = (await liveFrameCounts())?.mountedPayload;
    expect(mounted?.viewType).toBe('sidebar');
    expect(mounted?.scope).toBe('library');
    expect(mounted?.libraryId).toBeTruthy();
    const frame = probeFrame();
    expect(frame).not.toBeNull();

    // --- Theme change must not reload the document ---
    const readyBeforeTheme = (await liveFrameCounts())?.counts.ready ?? 0;
    await window.getByRole('button', { name: '设置' }).click();
    const themeDialog = window.getByRole('dialog', { name: '通用设置' });
    await themeDialog.getByRole('tab', { name: '外观' }).click();
    await themeDialog.getByRole('radio', { name: '亮色' }).click();
    await themeDialog.press('Escape');
    await expect(themeDialog).toBeHidden({ timeout: 10_000 });
    await expect.poll(async () => (await liveFrameCounts())?.counts.themeChanged ?? 0, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    // Ready count unchanged: the frame was not reloaded by the theme switch.
    expect((await liveFrameCounts())?.counts.ready ?? 0).toBe(readyBeforeTheme);

    // --- Reloading the document re-enters the handshake ---
    const liveFrame = probeFrame();
    expect(liveFrame).not.toBeNull();
    // The sandboxed document cannot reload itself (no allow-same-origin);
    // the parent re-navigates the frame with a bumped URL instead. A fresh
    // document is proven by the framenavigated event, then it must receive a
    // new mount + theme handshake (its own counters restart at zero).
    const navigated = new Promise<boolean>((resolve) => {
      const mainPage = application.windows()[0]!;
      const handler = (frame: Frame) => {
        if (frame.url().includes('view-contract-probe') && frame.url().includes('retry=')) {
          mainPage.off('framenavigated', handler);
          resolve(true);
        }
      };
      mainPage.on('framenavigated', handler);
    });
    await window.evaluate(() => {
      const frame = document.querySelector('.plugin-sidebar-view-frame') as HTMLIFrameElement | null;
      if (frame === null) return;
      const url = frame.src;
      const separator = url.includes('?') ? '&' : '?';
      frame.src = `${url}${separator}retry=${Date.now()}`;
    });
    await expect(navigated).resolves.toBe(true);
    await expect.poll(async () => (await liveFrameCounts())?.counts.mounted ?? 0, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await liveFrameCounts())?.counts.themeChanged ?? 0, { timeout: 30_000 })
      .toBeGreaterThanOrEqual(1);

    // --- Library isolation: a second library has no plugin contributions ---
    const { closeLibraryViaSwitcher } = await import('./electron-test-helpers');
    await closeLibraryViaSwitcher(window, libraryOne);
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryTwo);
    await window.getByRole('button', { name: '创建', exact: true }).click();
    // The plugin was installed in library scope on library one: the second
    // library must NOT surface the view entry (instance isolation). The
    // unmount notification reaches the closed library's frame as it tears
    // down; the isolation proof is that the new library has no entry at all.
    await expect(window.getByRole('button', { name: 'View contract probe' }))
      .toHaveCount(0, { timeout: 10_000 });
  } finally {
    if (mainStderr.length > 0) {
      await testInfo.attach('main-stderr', {
        body: mainStderr.join('\n'),
        contentType: 'text/plain',
      });
    }
    // Attach the activation-failure journal and the main-process log (both
    // now written under the isolated userData in E2E runs).
    const { readdirSync, readFileSync, existsSync, statSync } = await import('node:fs');
    const userDataRoot = path.join(temporaryRoot, 'user-data');
    if (existsSync(userDataRoot)) {
      const entries: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 3) return;
        try {
          for (const name of readdirSync(dir)) {
            const full = path.join(dir, name);
            const relative = path.relative(userDataRoot, full);
            entries.push(`${statSync(full).isDirectory() ? '[d]' : '[f]'} ${relative}`);
            if (statSync(full).isDirectory()) walk(full, depth + 1);
          }
        } catch {
          // Electron teardown may remove files mid-walk; best-effort only.
        }
      };
      walk(userDataRoot, 0);
      console.log('USERDATA-TREE', entries.join('\n'));
    }
    for (const [name, relative] of [
      ['plugin-activation-failures', 'plugin-activation-failures.jsonl'],
      ['serpent-log', path.join('logs', 'serpent.log')],
    ] as const) {
      const candidate = path.join(temporaryRoot, 'user-data', ...relative.split('/'));
      if (existsSync(candidate)) {
        const body = readFileSync(candidate, 'utf8');
        console.log(`${name}:\n${body}`);
        await testInfo.attach(name, { body, contentType: 'text/plain' });
      }
    }
    await application.close();
    // Electron releases its Singleton lock asynchronously; retry so the
    // cleanup does not race the child process teardown.
    rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
});
