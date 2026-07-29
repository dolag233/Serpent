import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPluginPackageRequestHandler } from '../../src/main/plugin-package-ipc';
import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writePlugin(
  directory: string,
  overrides: Partial<{ version: string; permissions: string[] }> = {},
): void {
  const manifest = {
    ...manifestFixture,
    version: overrides.version ?? manifestFixture.version,
    permissions: overrides.permissions ?? manifestFixture.permissions,
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

describe('Plugin package IPC bridge', () => {
  it('rejects malformed Renderer input before selecting a path or touching package storage', async () => {
    const userData = temporaryRoot('serpent-plugin-ipc-user-');
    let selectorCalled = false;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => undefined,
      chooseLocalPackage: async () => {
        selectorCalled = true;
        return undefined;
      },
    });

    await expect(handler({ type: 'plugin-manager.install-github', repository: 'https://example.com/nope' }))
      .resolves.toEqual({ ok: false, code: 'invalid-request' });
    expect(selectorCalled).toBe(false);
  });

  it('keeps a Main-selected local path out of Renderer responses and supports a cancelled picker', async () => {
    const source = temporaryRoot('serpent-plugin-ipc-source-');
    const userData = temporaryRoot('serpent-plugin-ipc-user-');
    writePlugin(source);
    let selected: string | undefined = source;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => undefined,
      chooseLocalPackage: async () => selected,
    });

    const installed = await handler({ type: 'plugin-manager.install-local', scope: 'user' });
    expect(installed.ok).toBe(true);
    expect(JSON.stringify(installed)).not.toContain(source);
    if (installed.ok) {
      expect(installed.packages).toMatchObject([{
        pluginId: 'com.example.palette-tools',
        scope: 'user',
        source: { kind: 'local-directory' },
        trust: 'trusted',
      }]);
    }

    selected = undefined;
    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' }))
      .resolves.toEqual({ ok: false, code: 'selection-cancelled' });
  });

  it('returns both exact conflict candidates, then requires library trust before it resolves', async () => {
    const userSource = temporaryRoot('serpent-plugin-ipc-user-source-');
    const librarySource = temporaryRoot('serpent-plugin-ipc-library-source-');
    const userData = temporaryRoot('serpent-plugin-ipc-user-');
    const library = temporaryRoot('serpent-plugin-ipc-library-');
    writePlugin(userSource, { version: '1.2.0' });
    writePlugin(librarySource, { version: '1.3.0' });
    let selected = userSource;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => selected,
    });

    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' })).resolves.toMatchObject({ ok: true });
    selected = librarySource;
    await expect(handler({
      type: 'plugin-manager.install-local',
      scope: 'library',
      libraryId: 'library-a',
    })).resolves.toMatchObject({ ok: true });

    const listed = await handler({ type: 'plugin-manager.list', libraryId: 'library-a' });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error('Expected a package listing.');
    const conflict = listed.resolutions.find((item) => item.status === 'conflict');
    expect(conflict).toMatchObject({
      pluginId: 'com.example.palette-tools',
      candidates: [
        { scope: 'user', version: '1.2.0', trust: 'trusted' },
        { scope: 'library', version: '1.3.0', trust: 'untrusted' },
      ],
    });
    if (conflict?.status !== 'conflict') throw new Error('Expected a conflict resolution.');
    const libraryCandidate = conflict.candidates.find((candidate) => candidate.scope === 'library');
    if (libraryCandidate === undefined) throw new Error('Expected the library candidate.');

    const pending = await handler({
      type: 'plugin-manager.resolve',
      libraryId: 'library-a',
      pluginId: 'com.example.palette-tools',
      selection: 'use-library',
      packageHash: libraryCandidate.packageHash,
    });
    expect(pending).toMatchObject({
      ok: true,
      resolutions: [{ status: 'awaiting-trust', packageHash: libraryCandidate.packageHash }],
    });

    const trusted = await handler({
      type: 'plugin-manager.trust',
      scope: 'library',
      libraryId: 'library-a',
      pluginId: 'com.example.palette-tools',
      packageHash: libraryCandidate.packageHash,
      decision: 'trusted',
    });
    expect(trusted).toMatchObject({
      ok: true,
      resolutions: [{
        status: 'resolved',
        selection: 'use-library',
        packageHash: libraryCandidate.packageHash,
      }],
    });
  });

  it('rolls back through the typed bridge and keeps the previous verified package selected', async () => {
    const firstSource = temporaryRoot('serpent-plugin-ipc-rollback-first-');
    const userData = temporaryRoot('serpent-plugin-ipc-rollback-user-');
    const library = temporaryRoot('serpent-plugin-ipc-rollback-library-');
    writePlugin(firstSource, { version: '1.2.0' });
    const selected = firstSource;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => selected,
    });

    const firstInstall = await handler({ type: 'plugin-manager.install-local', scope: 'user' });
    expect(firstInstall).toMatchObject({ ok: true, packages: [{ version: '1.2.0' }] });
    if (!firstInstall.ok) throw new Error('Expected the first plugin install to succeed.');
    const firstPackage = firstInstall.packages[0];
    if (firstPackage === undefined) throw new Error('Expected an installed package.');
    await expect(handler({
      type: 'plugin-manager.resolve',
      libraryId: 'library-a',
      pluginId: firstPackage.pluginId,
      selection: 'use-global',
      packageHash: firstPackage.packageHash,
    })).resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved', version: '1.2.0' }] });

    // An in-place edit is the same local source. A different picker location
    // is deliberately a source change and therefore requires confirmation.
    writePlugin(firstSource, { version: '1.3.0' });
    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' }))
      .resolves.toMatchObject({ ok: true, packages: [{ version: '1.2.0' }, { version: '1.3.0' }] });
    await expect(handler({ type: 'plugin-manager.list', libraryId: 'library-a' }))
      .resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved', version: '1.3.0' }] });
    await expect(handler({
      type: 'plugin-manager.rollback',
      libraryId: 'library-a',
      pluginId: firstPackage.pluginId,
    })).resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved', version: '1.2.0' }] });
  });
});
