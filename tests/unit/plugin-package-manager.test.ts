import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import AdmZip from 'adm-zip';
import { afterEach, describe, expect, it } from 'vitest';

import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import { PLUGIN_LIBRARY_LOCK_FILE } from '../../src/plugins/plugin-package';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writePlugin(
  directory: string,
  overrides: Partial<{
    version: string;
    runtime: 'standard' | 'trusted';
    permissions: string[];
    repository: string;
  }> = {},
): void {
  const manifest = {
    ...manifestFixture,
    version: overrides.version ?? manifestFixture.version,
    permissions: overrides.permissions ?? manifestFixture.permissions,
    ...(overrides.repository === undefined ? {} : { repository: overrides.repository }),
    runtime: overrides.runtime === 'trusted'
      ? { mode: 'trusted', entry: 'dist/main.js' }
      : manifestFixture.runtime,
  };
  mkdirSync(path.join(directory, 'dist', 'ui'), { recursive: true });
  writeFileSync(path.join(directory, 'serpent-plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(directory, 'dist', 'main.js'), `export const version = ${JSON.stringify(manifest.version)};\n`);
  writeFileSync(path.join(directory, 'dist', 'ui', 'index.html'), '<main>palette</main>\n');
  writeFileSync(path.join(directory, 'README.md'), '# Palette Tools\n');
  writeFileSync(path.join(directory, 'LICENSE'), 'MIT\n');
}

function createManager(userDataDirectory: string): PluginPackageManager {
  return new PluginPackageManager({
    userDataDirectory,
    deviceId: path.basename(userDataDirectory),
    serpentVersion: '0.2.4',
    pluginApiVersion: 1,
    platform: 'darwin',
    arch: 'arm64',
    nodeAbi: 140,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PluginPackageManager installation and integrity', () => {
  it('installs a verified directory by staging and atomically adds the package to the selected store', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(source);

    const manager = createManager(userData);
    const installed = await manager.installFromDirectory({
      directory: source,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'local:palette-tools' },
    });

    expect(installed.package.lock.pluginId).toBe('com.example.palette-tools');
    expect(installed.package.lock.version).toBe('1.2.0');
    expect(readFileSync(path.join(installed.packageDirectory, 'dist', 'main.js'), 'utf8')).toContain('version');
    expect(readFileSync(path.join(userData, 'plugins', 'plugin-lock.json'), 'utf8')).toContain('com.example.palette-tools');
    await expect(manager.listInstalled({ scope: 'user' })).resolves.toMatchObject([
      { status: 'valid', package: { lock: { pluginId: 'com.example.palette-tools', version: '1.2.0' } } },
    ]);
  });

  it('keeps library code and non-secret lock synchronized while trust stays on each device', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const library = temporaryRoot('serpent-plugin-library-');
    const userA = temporaryRoot('serpent-plugin-device-a-');
    const userB = temporaryRoot('serpent-plugin-device-b-');
    writePlugin(source);

    const managerA = createManager(userA);
    const installed = await managerA.installFromDirectory({
      directory: source,
      scope: 'library',
      libraryDirectory: library,
      source: { kind: 'local-directory', fingerprint: 'local:palette-tools' },
    });
    await managerA.recordTrust({
      package: installed.package,
      decision: 'trusted',
    });

    const managerB = createManager(userB);
    expect(readFileSync(path.join(library, PLUGIN_LIBRARY_LOCK_FILE), 'utf8')).toContain('com.example.palette-tools');
    await expect(managerB.listInstalled({ scope: 'library', libraryDirectory: library })).resolves.toMatchObject([
      { status: 'valid', package: { lock: { pluginId: 'com.example.palette-tools' } }, trust: undefined },
    ]);
    const installedForA = await managerA.listInstalled({ scope: 'library', libraryDirectory: library });
    expect(installedForA[0]).toMatchObject({ status: 'valid' });
    if (installedForA[0]?.status !== 'valid') throw new Error('Expected the library package to be valid.');
    expect(installedForA[0].trust).toMatchObject({ decision: 'trusted', deviceId: path.basename(userA) });
    await expect(managerB.resolve({
      libraryId: 'library-a',
      libraryDirectory: library,
      pluginId: installed.package.lock.pluginId,
    })).resolves.toMatchObject({ status: 'awaiting-trust', reason: 'untrusted' });
  });

  it('fails closed when installed package bytes no longer match the lock', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(source);
    const manager = createManager(userData);
    const installed = await manager.installFromDirectory({
      directory: source,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'local:palette-tools' },
    });
    writeFileSync(path.join(installed.packageDirectory, 'dist', 'main.js'), 'tampered');

    await expect(manager.listInstalled({ scope: 'user' })).resolves.toMatchObject([
      { status: 'invalid', errorCode: 'PLUGIN_PACKAGE_INTEGRITY_MISMATCH' },
    ]);
  });

  it('installs a local zip without executing package scripts and rejects traversal before extraction', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(source);
    const archive = new AdmZip();
    archive.addLocalFolder(source, 'palette-tools-main');
    const manager = createManager(userData);

    const installed = await manager.installFromArchive({
      archive: archive.toBuffer(),
      scope: 'user',
      source: { kind: 'local-package', fingerprint: 'zip:palette-tools' },
    });
    expect(installed.package.lock.pluginId).toBe('com.example.palette-tools');

    const traversal = new AdmZip();
    traversal.addFile('../escape.txt', Buffer.from('nope'));
    await expect(manager.installFromArchive({
      archive: traversal.toBuffer(),
      scope: 'user',
      source: { kind: 'local-package', fingerprint: 'zip:bad' },
    })).rejects.toMatchObject({ code: 'PLUGIN_ARCHIVE_INVALID' });
  });

  it('uses a GitHub repository client to pick the latest compatible tag without Releases or build commands', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(source, { version: '1.3.0' });
    const archive = new AdmZip();
    archive.addLocalFolder(source, 'palette-tools-1.3.0');
    const manager = createManager(userData);
    const downloadedRefs: string[] = [];

    const installed = await manager.installFromGitHub({
      repository: 'https://github.com/example/serpent-palette-tools',
      scope: 'user',
      client: {
        async listTags() {
          return [
            { name: 'v1.2.0', commitSha: 'a'.repeat(40) },
            { name: 'v1.3.0', commitSha: 'b'.repeat(40) },
          ];
        },
        async downloadArchive(_repository, ref) {
          downloadedRefs.push(ref);
          return { archive: archive.toBuffer(), commitSha: 'b'.repeat(40) };
        },
        async defaultBranch() {
          return { name: 'main', commitSha: 'c'.repeat(40) };
        },
      },
    });

    expect(downloadedRefs).toEqual(['v1.3.0']);
    expect(installed.package.lock.version).toBe('1.3.0');
    expect(installed.package.lock.sourceFingerprint).toContain('@bbbbbbbb');
  });
});

describe('PluginPackageManager selection, updates and Safe Mode', () => {
  it('requires an explicit per-device choice for a user/library version conflict and selects only one', async () => {
    const sourceOne = temporaryRoot('serpent-plugin-source-one-');
    const sourceTwo = temporaryRoot('serpent-plugin-source-two-');
    const library = temporaryRoot('serpent-plugin-library-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(sourceOne, { version: '1.2.0' });
    writePlugin(sourceTwo, { version: '1.3.0' });
    const manager = createManager(userData);
    const userPackage = await manager.installFromDirectory({
      directory: sourceOne,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'source:one' },
    });
    const libraryPackage = await manager.installFromDirectory({
      directory: sourceTwo,
      scope: 'library',
      libraryDirectory: library,
      source: { kind: 'local-directory', fingerprint: 'source:two' },
    });

    await expect(manager.resolve({ libraryId: 'library-a', libraryDirectory: library, pluginId: userPackage.package.lock.pluginId }))
      .resolves.toMatchObject({ status: 'conflict' });
    await manager.chooseResolution({
      libraryId: 'library-a',
      pluginId: userPackage.package.lock.pluginId,
      selection: 'use-library',
      packageHash: libraryPackage.package.lock.packageHash,
    });
    await manager.recordTrust({ package: libraryPackage.package, decision: 'trusted' });
    await expect(manager.resolve({ libraryId: 'library-a', libraryDirectory: library, pluginId: userPackage.package.lock.pluginId }))
      .resolves.toMatchObject({
        status: 'resolved',
        selection: 'use-library',
        package: { lock: { packageHash: libraryPackage.package.lock.packageHash } },
      });
  });

  it('preserves a same-source, same-mode, no-new-permission version selection but requires a new choice for risk changes', async () => {
    const sourceOne = temporaryRoot('serpent-plugin-source-one-');
    const sourceTwo = temporaryRoot('serpent-plugin-source-two-');
    const sourceThree = temporaryRoot('serpent-plugin-source-three-');
    const library = temporaryRoot('serpent-plugin-library-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(sourceOne, { version: '1.2.0' });
    writePlugin(sourceTwo, { version: '1.3.0' });
    writePlugin(sourceThree, { version: '1.4.0', permissions: ['asset.read', 'net.fetch'] });
    const manager = createManager(userData);
    const first = await manager.installFromDirectory({
      directory: sourceOne,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'source:stable' },
    });
    await manager.chooseResolution({
      libraryId: 'library-a',
      pluginId: first.package.lock.pluginId,
      selection: 'use-global',
      packageHash: first.package.lock.packageHash,
    });
    const safeUpgrade = await manager.installFromDirectory({
      directory: sourceTwo,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'source:stable' },
    });

    await expect(manager.resolve({ libraryId: 'library-a', libraryDirectory: library, pluginId: first.package.lock.pluginId }))
      .resolves.toMatchObject({ status: 'resolved', package: { lock: { packageHash: safeUpgrade.package.lock.packageHash } } });

    await manager.installFromDirectory({
      directory: sourceThree,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'source:stable' },
    });
    await expect(manager.resolve({ libraryId: 'library-a', libraryDirectory: library, pluginId: first.package.lock.pluginId }))
      .resolves.toMatchObject({ status: 'requires-confirmation', reason: 'permissions-increased' });
  });

  it('uses Safe Mode to suppress all third-party resolution without deleting installed packages', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(source);
    const manager = createManager(userData);
    const installed = await manager.installFromDirectory({
      directory: source,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'local:palette-tools' },
    });
    await manager.chooseResolution({
      libraryId: 'library-a',
      pluginId: installed.package.lock.pluginId,
      selection: 'use-global',
      packageHash: installed.package.lock.packageHash,
    });
    await manager.setSafeMode(true);

    await expect(manager.resolve({ libraryId: 'library-a', libraryDirectory: temporaryRoot('serpent-plugin-library-'), pluginId: installed.package.lock.pluginId }))
      .resolves.toMatchObject({ status: 'disabled', reason: 'safe-mode' });
    await expect(manager.listInstalled({ scope: 'user' })).resolves.toHaveLength(1);
  });

  it('detaches an uninstalled version from its lock before deleting its package bytes', async () => {
    const source = temporaryRoot('serpent-plugin-source-');
    const userData = temporaryRoot('serpent-plugin-user-');
    writePlugin(source);
    const manager = createManager(userData);
    const installed = await manager.installFromDirectory({
      directory: source,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'local:palette-tools' },
    });

    await manager.uninstall({
      scope: 'user',
      pluginId: installed.package.lock.pluginId,
      version: installed.package.lock.version,
    });

    await expect(manager.listInstalled({ scope: 'user' })).resolves.toEqual([]);
  });
});
