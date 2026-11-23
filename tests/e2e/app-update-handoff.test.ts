import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { _electron as electron, expect, test } from '@playwright/test';

import { resolveElectronExecutablePath } from './electron-test-helpers';

const packageVersion = (JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
) as { version: string }).version;

function nextPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(version);
  if (!match) throw new TypeError(`Invalid package version: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

test('Windows installed update hands off without a terminal and schedules hidden cleanup', async () => {
  test.skip(process.platform !== 'win32', 'The installed update handoff is Windows-specific.');
  test.setTimeout(60_000);

  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'serpent-update-handoff-e2e-'));
  const profilePath = path.join(temporaryRoot, 'profile');
  const updateStagingPath = path.join(profilePath, 'update-staging');
  const downloadsPath = path.join(temporaryRoot, 'downloads');
  const tempPath = path.join(temporaryRoot, 'temp');
  const archivePath = path.join(temporaryRoot, 'setup.zip');
  const releasePath = path.join(temporaryRoot, 'release.json');
  const spawnLogPath = path.join(temporaryRoot, 'spawn-log.jsonl');
  const latestVersion = nextPatchVersion(packageVersion);
  const assetName = `Serpent-win-x86-64-${latestVersion}-setup.zip`;
  const assetUrl = `https://github.com/dolag233/Serpent/releases/download/v${latestVersion}/${assetName}`;
  const installerArchive = new AdmZip();
  installerArchive.addFile('SerpentSetup.exe', Buffer.from('inert E2E installer fixture'));
  const archiveBytes = installerArchive.toBuffer();
  const sha256 = createHash('sha256').update(archiveBytes).digest('hex');

  mkdirSync(profilePath, { recursive: true });
  const abandonedInstaller = path.join(updateStagingPath, 'serpent-installer-AbCd12');
  const recentInstaller = path.join(updateStagingPath, 'serpent-installer-CdEf34');
  const interruptedDownload = path.join(updateStagingPath, 'serpent-installer-EfGh56');
  mkdirSync(abandonedInstaller, { recursive: true });
  mkdirSync(recentInstaller, { recursive: true });
  mkdirSync(interruptedDownload, { recursive: true });
  writeFileSync(path.join(abandonedInstaller, 'unfinished.zip'), 'partial');
  writeFileSync(path.join(abandonedInstaller, '.installer-handoff'), '');
  writeFileSync(path.join(recentInstaller, '.installer-handoff'), '');
  writeFileSync(path.join(interruptedDownload, 'unfinished.zip'), 'partial');
  const stale = new Date(Date.now() - 48 * 60 * 60_000);
  utimesSync(abandonedInstaller, stale, stale);
  mkdirSync(downloadsPath, { recursive: true });
  mkdirSync(tempPath, { recursive: true });
  writeFileSync(archivePath, archiveBytes);
  writeFileSync(releasePath, JSON.stringify({
    tag_name: `v${latestVersion}`,
    html_url: `https://github.com/dolag233/Serpent/releases/tag/v${latestVersion}`,
    draft: false,
    prerelease: false,
    assets: [{
      name: assetName,
      browser_download_url: assetUrl,
      size: archiveBytes.byteLength,
      digest: `sha256:${sha256}`,
    }],
  }));

  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let applicationProcess: ChildProcess | undefined;
  try {
    application = await electron.launch({
      executablePath: resolveElectronExecutablePath(),
      args: [process.cwd()],
      cwd: process.cwd(),
      env: {
        ...process.env,
        SERPENT_E2E: '1',
        SERPENT_E2E_HIDE_WINDOW: '1',
        SERPENT_E2E_APP_UPDATE_FIXTURE: '1',
        SERPENT_E2E_USER_DATA_PATH: profilePath,
        SERPENT_E2E_DOWNLOADS_PATH: downloadsPath,
        SERPENT_E2E_TEMP_PATH: tempPath,
        SERPENT_E2E_UPDATE_RELEASE: releasePath,
        SERPENT_E2E_UPDATE_ARCHIVE: archivePath,
        SERPENT_E2E_UPDATE_ASSET_URL: assetUrl,
        SERPENT_E2E_APP_UPDATE_SPAWN_LOG: spawnLogPath,
        SERPENT_DISTRIBUTION: 'installed',
      },
    });
    const childProcess = application.process();
    applicationProcess = childProcess;

    const window = await application.firstWindow();
    await window.waitForLoadState('load');
    await expect.poll(() => existsSync(abandonedInstaller)).toBe(false);
    await expect.poll(() => existsSync(interruptedDownload)).toBe(false);
    expect(existsSync(recentInstaller)).toBe(true);
    const check = await window.evaluate(async () => {
      const appUpdate = (window as unknown as {
        serpent?: { appUpdate?: { checkForUpdates: () => Promise<unknown> } };
      }).serpent?.appUpdate;
      return await appUpdate?.checkForUpdates();
    });
    expect(check).toMatchObject({
      ok: true,
      status: 'available',
      latestVersion,
      distribution: 'installed',
      assetName,
    });

    const installStarted = await window.evaluate(() => {
      const appUpdate = (window as unknown as {
        serpent?: { appUpdate?: { downloadAndInstall: () => Promise<unknown> } };
      }).serpent?.appUpdate;
      if (!appUpdate) return false;
      void appUpdate.downloadAndInstall();
      return true;
    });
    expect(installStarted).toBe(true);

    try {
      await expect.poll(() => childProcess.exitCode, { timeout: 30_000 }).not.toBeNull();
    } catch (error) {
      const logsDirectory = path.join(profilePath, 'logs');
      const sessionLog = existsSync(logsDirectory)
        ? readdirSync(logsDirectory).find((name) => name.startsWith('serpent-'))
        : undefined;
      const updateEvents = sessionLog === undefined
        ? []
        : readFileSync(path.join(logsDirectory, sessionLog), 'utf8')
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => JSON.parse(line) as {
            scope?: string;
            message?: string;
            error?: { name?: string; message?: string };
          })
          .filter((entry) => entry.scope?.startsWith('app-update'))
          .map(({ scope, message, error }) => ({ scope, message, error }));
      const installerDirectories = existsSync(updateStagingPath)
        ? readdirSync(updateStagingPath).filter((name) => name.startsWith('serpent-installer-'))
        : [];
      const installerEntries = installerDirectories.flatMap((directory) =>
        readdirSync(path.join(updateStagingPath, directory)));
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; `
        + `updateEvents=${JSON.stringify(updateEvents)}; `
        + `installerEntries=${JSON.stringify(installerEntries)}`,
        { cause: error },
      );
    }

    const logsDirectory = path.join(profilePath, 'logs');
    const sessionLog = readdirSync(logsDirectory).find((name) => name.startsWith('serpent-'));
    expect(sessionLog).toBeTruthy();
    expect(readFileSync(path.join(logsDirectory, sessionLog!), 'utf8'))
      .not.toContain('"scope":"main.startup"');

    const spawnRecords = readFileSync(spawnLogPath, 'utf8')
      .trim()
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        executable: string;
        args: string[];
        installerPath?: string;
        windowsHide: boolean;
        detached: boolean;
        spawned: boolean;
        stdio: unknown;
        pid?: number;
      });
    const cleanupSpawn = spawnRecords.find((record) =>
      path.win32.basename(record.executable).toLowerCase() === 'powershell.exe');
    expect(cleanupSpawn).toMatchObject({
      windowsHide: true,
      detached: true,
      spawned: true,
    });
    expect(cleanupSpawn?.stdio).toBe('ignore');
    expect(cleanupSpawn?.pid).toBeGreaterThan(0);
    expect(cleanupSpawn?.args).toContain('-WindowStyle');
    expect(cleanupSpawn?.args).toContain('Hidden');
    expect(spawnRecords.some((record) =>
      ['cmd.exe', 'ping.exe'].includes(path.win32.basename(record.executable).toLowerCase()))).toBe(false);

    const installerPath = cleanupSpawn?.installerPath;
    expect(installerPath).toBeTruthy();
    expect(path.win32.relative(
      path.win32.resolve(updateStagingPath),
      path.win32.resolve(path.win32.dirname(installerPath!)),
    ).startsWith('..')).toBe(false);
    expect(existsSync(downloadsPath) ? readdirSync(downloadsPath) : []).toEqual([]);
  } finally {
    try {
      if (applicationProcess?.exitCode === null) {
        const exited = new Promise<void>((resolve) => {
          applicationProcess?.once('exit', () => resolve());
        });
        applicationProcess.kill();
        await Promise.race([
          exited,
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ]);
      }
      await application?.close().catch(() => undefined);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
});
