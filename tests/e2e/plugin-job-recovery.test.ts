import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';

import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

import { electronLaunchEnv, resolveElectronExecutablePath } from './electron-test-helpers';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';

test.describe.configure({ timeout: 180_000 });

const FIXTURE_ROOT = path.resolve('tests/fixtures/plugins/job-probe');
const PLUGIN_ID = 'com.serpent.job-probe';

type PluginStorageDocument = {
  values: Record<string, unknown>;
};

type PluginJobSnapshot = {
  jobId: string;
  status: string;
  errorCode: string | null;
  attemptCount: number;
  progress: number;
  ownerPluginInstanceId?: string;
};

function readPluginStorage(storagePath: string): PluginStorageDocument | null {
  if (!existsSync(storagePath)) return null;
  try {
    return JSON.parse(readFileSync(storagePath, 'utf8')) as PluginStorageDocument;
  } catch {
    return null;
  }
}

async function killApplication(application: ElectronApplication): Promise<void> {
  const child = application.process();
  if (child.exitCode !== null) return;
  const descendants = (pid: number): number[] => {
    if (process.platform === 'win32') return [];
    try {
      const output = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
      return output
        .split(/\s+/u)
        .filter(Boolean)
        .map(Number)
        .flatMap((childPid) => [childPid, ...descendants(childPid)]);
    } catch {
      return [];
    }
  };
  const descendantPids = descendants(child.pid ?? 0).reverse();
  const exited = once(child, 'exit');
  // Kill the Electron parent first. Otherwise a plugin-host exit can reach
  // Main's crash callback and intentionally pause the job before the process
  // restart recovery path gets a chance to inspect the interrupted row.
  child.kill('SIGKILL');
  for (const descendant of descendantPids) {
    try {
      process.kill(descendant, 'SIGKILL');
    } catch {
      // The descendant may have exited with the parent already.
    }
  }
  await exited;
}

test('does not resume a plugin job after the whole Electron process restarts', async () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-job-recovery-e2e-'));
  const libraryName = '插件任务重启恢复';
  const userDataPath = path.join(temporaryRoot, 'user-data');
  const packageDirectory = path.join(temporaryRoot, 'job-probe');
  cpSync(FIXTURE_ROOT, packageDirectory, { recursive: true });

  const executablePath = resolveElectronExecutablePath();
  const applicationDirectory = process.env.SERPENT_E2E_APP_DIRECTORY ?? process.cwd();
  const launch = async (): Promise<ElectronApplication> => electron.launch({
    args: [applicationDirectory],
    cwd: applicationDirectory,
    executablePath,
    env: electronLaunchEnv({
      SERPENT_E2E: '1',
      SERPENT_E2E_RESTORE_RECENT: '1',
      SERPENT_E2E_USER_DATA_PATH: userDataPath,
      SERPENT_E2E_CREATE_PARENT_PATH: temporaryRoot,
      SERPENT_E2E_PLUGIN_PACKAGE: packageDirectory,
    }),
  });

  let application = await launch();
  const libraryDirectory = path.join(temporaryRoot, libraryName);
  const storagePath = path.join(
    libraryDirectory,
    PLUGIN_LIBRARY_DATA_DIRECTORY,
    `${PLUGIN_ID}.json`,
  );
  const readJobSnapshots = async (page: Page, id: string): Promise<PluginJobSnapshot[]> => page.evaluate(async (libraryId) => {
    const result = await (window as unknown as {
      serpent?: { library?: { listPluginJobs: (input: { libraryId: string }) => Promise<{
        ok: boolean;
        value?: { jobs: Array<PluginJobSnapshot> };
      }> } };
    }).serpent?.library?.listPluginJobs({ libraryId });
    if (result?.ok !== true) return [];
    return result.value?.jobs ?? [];
  }, id);
  const readJobSnapshot = async (page: Page, id: string): Promise<PluginJobSnapshot | null> =>
    (await readJobSnapshots(page, id))[0] ?? null;

  try {
    const window = await application.firstWindow();
    await window.getByRole('button', { name: '创建资源库' }).click();
    await window.getByRole('textbox', { name: '名称' }).fill(libraryName);
    await window.getByRole('button', { name: '创建', exact: true }).click();

    await window.getByRole('button', { name: '设置', exact: true }).click();
    const dialog = window.getByRole('dialog', { name: '通用设置' });
    await dialog.getByRole('tab', { name: '插件' }).click();
    await expect(dialog.getByText('暂未安装插件。', { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: '安装插件' }).click();
    const installDialog = window.getByRole('dialog', { name: '安装插件' });
    await installDialog.getByLabel('安装范围').selectOption('library');
    await installDialog.getByRole('button', { name: '本地安装' }).click();
    await expect(dialog.getByText(/Job Probe\s*-\s*v1\.0\.0/)).toBeVisible({ timeout: 30_000 });
    await dialog.getByRole('button', { name: '信任', exact: true }).click();
    await expect(dialog.getByRole('checkbox', { name: '启用插件' })).toBeChecked();

    const libraryId = await window.evaluate(async () => {
      const result = await (window as unknown as {
        serpent?: { library?: { listOpen: () => Promise<{ ok: boolean; value?: Array<{ libraryId: string }> }> } };
      }).serpent?.library?.listOpen();
      return result?.ok === true ? result.value?.[0]?.libraryId ?? null : null;
    });
    expect(libraryId).toEqual(expect.any(String));
    const runStartCommand = async (page: Page): Promise<{ ok: boolean; executed?: boolean; code?: string }> => page.evaluate(async ({ id, pluginId }) => {
      return (window as unknown as {
        serpent?: { plugins?: { runPluginCommand: (input: {
          type: 'plugin-manager.run-command';
          libraryId: string;
          pluginId: string;
          commandId: string;
        }) => Promise<{ ok: boolean; executed?: boolean; code?: string }> } };
      }).serpent?.plugins?.runPluginCommand({
        type: 'plugin-manager.run-command',
        libraryId: id,
        pluginId,
        commandId: 'start',
      }) ?? { ok: false };
    }, { id: libraryId as string, pluginId: PLUGIN_ID });
    let commandResult: { ok: boolean; executed?: boolean; code?: string } = { ok: false };
    await expect.poll(async () => {
      commandResult = await runStartCommand(window);
      return commandResult.ok;
    }, { timeout: 15_000, intervals: [250, 500, 1_000] }).toBe(true);
    expect(commandResult).toMatchObject({ ok: true, executed: true });

    // The fixture records its first execution before deliberately keeping the
    // handler in flight. This leaves a real running row on disk for SIGKILL.
    await expect.poll(
      () => readPluginStorage(storagePath)?.values['job-attempts'] ?? null,
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    ).toBe(1);
    const firstJobSnapshot = await readJobSnapshot(window, libraryId as string);
    expect(firstJobSnapshot).toMatchObject({ status: 'running', attemptCount: 1 });
    const firstInstanceId = firstJobSnapshot?.ownerPluginInstanceId;
    expect(firstInstanceId).toEqual(expect.any(String));
    await expect(dialog.getByRole('button', { name: '关闭' })).toBeVisible();
    await killApplication(application);

    application = await launch();
    const restartedWindow = await application.firstWindow();
    await expect(
      restartedWindow.getByRole('button', { name: `当前资源库 ${libraryName}` }),
    ).toBeVisible({ timeout: 30_000 });

    // A second process must reopen the same library without re-running the
    // previous row. The old row remains visible as an explicit terminal state.
    await expect.poll(
      async () => (await readJobSnapshot(restartedWindow, libraryId as string))?.status ?? null,
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    ).toBe('interrupted');
    expect(await readJobSnapshot(restartedWindow, libraryId as string)).toMatchObject({
      status: 'interrupted',
      errorCode: 'PLUGIN_JOB_INTERRUPTED',
      attemptCount: 1,
    });
    expect(readPluginStorage(storagePath)?.values['job-attempts']).toBe(1);
    expect(readPluginStorage(storagePath)?.values['job-tick']).toBeUndefined();

    // A new command in the new session still creates and runs a new Job.
    commandResult = { ok: false };
    await expect.poll(async () => {
      commandResult = await runStartCommand(restartedWindow);
      return commandResult.ok;
    }, { timeout: 15_000, intervals: [250, 500, 1_000] }).toBe(true);
    expect(commandResult).toMatchObject({ ok: true, executed: true });
    await expect.poll(
      () => readPluginStorage(storagePath)?.values['job-tick'] ?? null,
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    ).toEqual({ tick: 1 });
    expect(readPluginStorage(storagePath)?.values['job-attempts']).toBe(2);
    await expect.poll(
      async () => (await readJobSnapshot(restartedWindow, libraryId as string))?.status ?? null,
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    ).toBe('succeeded');
    expect(await readJobSnapshot(restartedWindow, libraryId as string)).toMatchObject({
      status: 'succeeded',
      errorCode: null,
      progress: 1,
    });
    const jobsAfterExplicitStart = await readJobSnapshots(restartedWindow, libraryId as string);
    expect(jobsAfterExplicitStart.find((item) => item.jobId === firstJobSnapshot?.jobId)).toMatchObject({
      status: 'interrupted',
      attemptCount: 1,
    });
    expect((await readJobSnapshot(restartedWindow, libraryId as string))?.ownerPluginInstanceId)
      .not.toBe(firstInstanceId);
  } finally {
    if (application.process().exitCode === null) await application.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
