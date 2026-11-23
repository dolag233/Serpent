import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { createWindowsInstallerCleanupInvocation } from '../../src/main/windows-installer-cleanup';

describe('Windows installer cleanup helper', () => {
  it('starts one hidden PowerShell worker and retries cleanup without ping or a command shell', () => {
    const invocation = createWindowsInstallerCleanupInvocation({
      installerPath: 'SerpentTmp\\serpent-installer-example\\SerpentSetup.exe',
      installerPid: 1234,
      logPath: 'SerpentLogs\\session.log',
      environment: { PATH: 'test-path' },
    });
    const encodedScript = invocation.args.at(-1);
    expect(encodedScript).toBeDefined();
    const script = Buffer.from(encodedScript!, 'base64').toString('utf16le');

    expect(invocation.executable.toLowerCase()).toMatch(/powershell\.exe$/u);
    expect(invocation.args).toContain('-WindowStyle');
    expect(invocation.args).toContain('Hidden');
    expect(invocation.args).toContain('-NonInteractive');
    expect(invocation.args).toContain('-ExecutionPolicy');
    expect(invocation.args).toContain('Bypass');
    expect(script).toContain('Get-Process -Name $installerProcessName');
    expect(script).toContain('Start-Sleep -Milliseconds 500');
    expect(script).toContain('Remove-Item -LiteralPath $installerPath');
    expect(script).toContain('Remove-Item -LiteralPath $installerDirectory');
    expect(script).toContain("scope = 'app-update.cleanup'");
    expect(script).not.toMatch(/\bping\b/iu);
    expect(script).not.toMatch(/\bcmd\.exe\b/iu);
    expect(invocation.env.SERPENT_UPDATE_CLEANUP_INSTALLER)
      .toBe('SerpentTmp\\serpent-installer-example\\SerpentSetup.exe');
    expect(invocation.env.SERPENT_UPDATE_CLEANUP_DIRECTORY)
      .toBe('SerpentTmp\\serpent-installer-example');
    expect(invocation.env.SERPENT_UPDATE_CLEANUP_PID).toBe('1234');
    expect(invocation.env.SERPENT_UPDATE_CLEANUP_LOG).toBe('SerpentLogs\\session.log');
  });

  it('does not embed user paths in the encoded PowerShell command', () => {
    const invocation = createWindowsInstallerCleanupInvocation({
      installerPath: 'SerpentTmp\\installer\\SerpentSetup.exe',
      environment: { PATH: 'test-path' },
    });
    const encodedScript = invocation.args.at(-1)!;
    const script = Buffer.from(encodedScript, 'base64').toString('utf16le');

    expect(script).not.toContain('SerpentTmp');
    expect(script).not.toContain('SerpentSetup.exe');
    expect(invocation.env.SERPENT_UPDATE_CLEANUP_PID).toBe('');
  });

  it.skipIf(process.platform !== 'win32')('removes an unlocked installer directory with the real hidden worker', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'serpent-update-cleanup-test-'));
    const installerDirectory = path.join(root, 'serpent-installer-test');
    const installerPath = path.join(installerDirectory, 'SerpentSetup.exe');
    try {
      await mkdir(installerDirectory);
      await writeFile(installerPath, 'test installer');
      await writeFile(path.join(installerDirectory, '.installer-handoff'), '');
      await writeFile(path.join(installerDirectory, 'download.zip'), 'test archive');
      const invocation = createWindowsInstallerCleanupInvocation({
        installerPath,
        installerPid: 730241,
      });
      const child = spawn(invocation.executable, invocation.args, {
        windowsHide: true,
        stdio: 'ignore',
        env: invocation.env,
      });
      const exitCode = await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code) => resolve(code ?? -1));
      });

      expect(exitCode).toBe(0);
      const removalDeadline = Date.now() + 5_000;
      let installerDirectoryExists = true;
      while (installerDirectoryExists && Date.now() < removalDeadline) {
        try {
          await access(installerDirectory);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch {
          installerDirectoryExists = false;
        }
      }
      expect(installerDirectoryExists, JSON.stringify({
        installerStillExists: existsSync(installerPath),
        remainingEntries: existsSync(installerDirectory) ? readdirSync(installerDirectory) : [],
      })).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
