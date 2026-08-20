import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import AdmZip from 'adm-zip';

import {
  createAppUpdateService,
  detectAppDistribution,
  parseGitHubRelease,
  parseSha256,
  resolveAppUpdateTarget,
  selectUpdateAsset,
  updateAssetName,
} from '../../src/main/app-update-service';

function releasePayload(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v0.1.3',
    html_url: 'https://github.com/dolag233/Serpent/releases/tag/v0.1.3',
    draft: false,
    prerelease: false,
    body: 'Release notes',
    assets: [
      {
        name: 'Serpent-darwin-arm64-0.1.3-package.dmg',
        browser_download_url: 'https://github.com/dolag233/Serpent/releases/download/v0.1.3/Serpent-darwin-arm64-0.1.3-package.dmg',
        size: 123,
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
    ...overrides,
  };
}

describe('Serpent app update release contract', () => {
  it('distinguishes development, Inno-installed, and portable launches', () => {
    expect(detectAppDistribution({
      isPackaged: false,
      platform: 'darwin',
      executablePath: '/Applications/Serpent.app/Contents/MacOS/Serpent',
    })).toBe('development');

    expect(detectAppDistribution({
      isPackaged: true,
      platform: 'win32',
      executablePath: 'C:\\Program Files\\Serpent\\Serpent.exe',
      fileExists: (filePath) => filePath.endsWith('.serpent-installed'),
    })).toBe('installed');

    expect(detectAppDistribution({
      isPackaged: true,
      platform: 'win32',
      executablePath: 'C:\\Program Files\\Serpent\\Serpent.exe',
      fileExists: (filePath) => filePath.endsWith('unins000.exe'),
    })).toBe('installed');

    expect(detectAppDistribution({
      isPackaged: true,
      platform: 'win32',
      executablePath: 'D:\\Tools\\Serpent\\Serpent.exe',
      environment: { PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\Serpent\\Serpent.exe' },
    })).toBe('portable');

    expect(detectAppDistribution({
      isPackaged: true,
      platform: 'darwin',
      executablePath: '/Applications/Serpent.app/Contents/MacOS/Serpent',
    })).toBe('installed');
  });

  it('maps each release target to the established release asset name', () => {
    const installedMac = resolveAppUpdateTarget({
      platform: 'darwin',
      arch: 'arm64',
      distribution: 'installed',
    });
    const portableWindows = resolveAppUpdateTarget({
      platform: 'win32',
      arch: 'x64',
      distribution: 'portable',
    });
    expect(installedMac).toEqual({ platform: 'darwin', arch: 'arm64', distribution: 'installed' });
    expect(portableWindows).toEqual({ platform: 'win32', arch: 'x64', distribution: 'portable' });
    expect(updateAssetName('0.1.3', installedMac!)).toEqual({
      name: 'Serpent-darwin-arm64-0.1.3-package.dmg',
      assetKind: 'installer',
    });
    expect(updateAssetName('0.1.3', portableWindows!)).toEqual({
      name: 'Serpent-win-x86-64-0.1.3-portable.zip',
      assetKind: 'portable',
    });
    expect(resolveAppUpdateTarget({
      platform: 'darwin',
      arch: 'x64',
      distribution: 'installed',
    })).toBeUndefined();
  });

  it('parses GitHub releases and requires a verifiable selected asset', () => {
    const release = parseGitHubRelease(releasePayload());
    expect(release?.version).toBe('0.1.3');
    expect(parseSha256('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  file.zip'))
      .toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(parseSha256('not a checksum')).toBeUndefined();

    const target = resolveAppUpdateTarget({
      platform: 'darwin',
      arch: 'arm64',
      distribution: 'installed',
    });
    expect(selectUpdateAsset(release!, target!)).toMatchObject({
      assetKind: 'installer',
      asset: { name: 'Serpent-darwin-arm64-0.1.3-package.dmg' },
    });
    expect(parseGitHubRelease({ ...releasePayload(), prerelease: true })).toBeUndefined();
    expect(selectUpdateAsset(
      parseGitHubRelease({
        ...releasePayload(),
        assets: [{
          name: 'Serpent-darwin-arm64-0.1.3-package.dmg',
          browser_download_url: 'https://github.com/dolag233/Serpent/releases/download/v0.1.3/Serpent-darwin-arm64-0.1.3-package.dmg',
          size: 123,
        }],
      })!,
      target!,
    )).toBeUndefined();
  });

  it('checks a newer release without exposing a filesystem path to the result', async () => {
    const service = createAppUpdateService({
      currentVersion: '0.1.2',
      isPackaged: true,
      platform: 'darwin',
      arch: 'arm64',
      executablePath: '/tmp/Serpent.app/Contents/MacOS/Serpent',
      tempDirectory: '/tmp',
      downloadsDirectory: '/tmp',
      environment: { SERPENT_DISTRIBUTION: 'installed' },
      fetchImpl: async () => new Response(JSON.stringify(releasePayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    const result = await service.checkForUpdates();
    expect(result).toMatchObject({
      ok: true,
      status: 'available',
      latestVersion: '0.1.3',
      assetName: 'Serpent-darwin-arm64-0.1.3-package.dmg',
    });
    expect(JSON.stringify(result)).not.toContain('/tmp');
  });

  it('downloads, verifies, and reveals a portable update without replacing the running app', async () => {
    const portableBytes = Buffer.from('portable update bytes');
    const checksum = createHash('sha256').update(portableBytes).digest('hex');
    const root = await mkdtemp(path.join(tmpdir(), 'serpent-app-update-test-'));
    const revealed: string[] = [];
    try {
      const payload = releasePayload({
        assets: [{
          name: 'Serpent-win-x86-64-0.1.3-portable.zip',
          browser_download_url: 'https://github.com/dolag233/Serpent/releases/download/v0.1.3/Serpent-win-x86-64-0.1.3-portable.zip',
          size: portableBytes.byteLength,
        }, {
          name: 'Serpent-win-x86-64-0.1.3-portable.zip.sha256',
          browser_download_url: 'https://github.com/dolag233/Serpent/releases/download/v0.1.3/Serpent-win-x86-64-0.1.3-portable.zip.sha256',
          size: checksum.length,
        }],
      });
      const service = createAppUpdateService({
        currentVersion: '0.1.2',
        isPackaged: true,
        platform: 'win32',
        arch: 'x64',
        executablePath: path.join(root, 'Serpent.exe'),
        tempDirectory: root,
        downloadsDirectory: path.join(root, 'Downloads'),
        environment: { SERPENT_DISTRIBUTION: 'portable' },
        fetchImpl: async (url) => {
          if (url.endsWith('/releases/latest')) return new Response(JSON.stringify(payload));
          if (url.endsWith('.sha256')) return new Response(`${checksum}\n`);
          return new Response(portableBytes);
        },
        showItemInFolder: (filePath) => revealed.push(filePath),
      });

      const result = await service.downloadAndInstall();
      expect(result).toEqual({
        ok: true,
        status: 'completed',
        action: 'portable-downloaded',
        version: '0.1.3',
        distribution: 'portable',
      });
      expect(revealed).toHaveLength(1);
      expect(await readFile(revealed[0]!)).toEqual(portableBytes);
      expect(revealed[0]).toContain('Serpent-win-x86-64-0.1.3-portable.zip');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('extracts and opens the verified Windows installer for an installed launch', async () => {
    const installerBytes = Buffer.from('Serpent installer bytes');
    const archive = new AdmZip();
    archive.addFile('SerpentSetup.exe', installerBytes);
    const archiveBytes = archive.toBuffer();
    const checksum = createHash('sha256').update(archiveBytes).digest('hex');
    const root = await mkdtemp(path.join(tmpdir(), 'serpent-app-update-installer-test-'));
    const opened: string[] = [];
    try {
      const payload = releasePayload({
        assets: [{
          name: 'Serpent-win-x86-64-0.1.3-setup.zip',
          browser_download_url: 'https://github.com/dolag233/Serpent/releases/download/v0.1.3/Serpent-win-x86-64-0.1.3-setup.zip',
          size: archiveBytes.byteLength,
        }, {
          name: 'Serpent-win-x86-64-0.1.3-setup.zip.sha256',
          browser_download_url: 'https://github.com/dolag233/Serpent/releases/download/v0.1.3/Serpent-win-x86-64-0.1.3-setup.zip.sha256',
          size: checksum.length,
        }],
      });
      const service = createAppUpdateService({
        currentVersion: '0.1.2',
        isPackaged: true,
        platform: 'win32',
        arch: 'x64',
        executablePath: path.join(root, 'Serpent.exe'),
        tempDirectory: root,
        downloadsDirectory: path.join(root, 'Downloads'),
        environment: { SERPENT_DISTRIBUTION: 'installed' },
        fetchImpl: async (url) => {
          if (url.endsWith('/releases/latest')) return new Response(JSON.stringify(payload));
          if (url.endsWith('.sha256')) return new Response(`${checksum}\n`);
          return new Response(archiveBytes as unknown as BodyInit);
        },
        openPath: async (filePath) => {
          opened.push(filePath);
          return '';
        },
      });

      const result = await service.downloadAndInstall();
      expect(result).toEqual({
        ok: true,
        status: 'completed',
        action: 'installer-opened',
        version: '0.1.3',
        distribution: 'installed',
      });
      expect(opened).toHaveLength(1);
      expect(path.basename(opened[0]!)).toBe('SerpentSetup.exe');
      expect(await readFile(opened[0]!)).toEqual(installerBytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
