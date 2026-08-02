import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPluginPackageRequestHandler } from '../../src/main/plugin-package-ipc';
import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import { PluginSettingsStore } from '../../src/main/plugin-settings-store';
import { PluginStorageStore } from '../../src/main/plugin-storage-store';
import { pluginManifestSchema } from '../../src/plugins/plugin-manifest';
import { pluginManagerRequestSchema } from '../../src/shared/plugin-manager-api';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writePlugin(directory: string): void {
  mkdirSync(path.join(directory, 'dist', 'ui'), { recursive: true });
  writeFileSync(path.join(directory, 'serpent-plugin.json'), `${JSON.stringify(manifestFixture, null, 2)}\n`);
  writeFileSync(path.join(directory, 'dist', 'main.js'), 'export const plugin = true;\n');
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

describe('Plugin settings sections IPC', () => {
  it('accepts select options and hover help metadata in a settings contribution', () => {
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        settings: [{
          id: 'quality',
          title: 'Quality',
          type: 'select',
          description: 'Controls processing quality.',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'high', label: 'High' },
          ],
        }],
      },
    });

    expect(manifest.contributes.settings[0]).toMatchObject({
      id: 'quality',
      type: 'select',
      description: 'Controls processing quality.',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'high', label: 'High' },
      ],
    });
  });

  it('parses settings contribution listing and get/set requests', () => {
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'settings.sections',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'settings.sections',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.get-plugin-settings',
      pluginId: 'com.example.palette-tools',
      scope: 'library',
      libraryId: 'library-a',
    })).toMatchObject({
      type: 'plugin-manager.get-plugin-settings',
      scope: 'library',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.set-plugin-setting',
      pluginId: 'com.example.palette-tools',
      scope: 'library',
      libraryId: 'library-a',
      settingId: 'palette-size',
      value: 12,
    })).toMatchObject({
      type: 'plugin-manager.set-plugin-setting',
      settingId: 'palette-size',
      value: 12,
    });
  });

  it('round-trips host settings through PluginSettingsStore and mirrors to plugin storage', async () => {
    const source = temporaryRoot('serpent-plugin-settings-ipc-source-');
    const userData = temporaryRoot('serpent-plugin-settings-ipc-user-');
    const library = temporaryRoot('serpent-plugin-settings-ipc-library-');
    writePlugin(source);
    const manager = createManager(userData);
    const settingsStore = new PluginSettingsStore(userData);
    const storageStore = new PluginStorageStore(userData);
    const handler = createPluginPackageRequestHandler({
      manager,
      settingsStore,
      storageStore,
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => source,
    });

    await expect(handler({
      type: 'plugin-manager.install-local',
      scope: 'library',
      libraryId: 'library-a',
    })).resolves.toMatchObject({ ok: true });

    const listed = await handler({
      type: 'plugin-manager.list',
      libraryId: 'library-a',
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok || !('packages' in listed)) throw new Error('expected package list');
    const libraryPackage = listed.packages.find((entry) => entry.scope === 'library');
    if (libraryPackage === undefined) throw new Error('expected library package');

    await expect(handler({
      type: 'plugin-manager.trust',
      scope: 'library',
      libraryId: 'library-a',
      pluginId: libraryPackage.pluginId,
      packageHash: libraryPackage.packageHash,
      decision: 'trusted',
    })).resolves.toMatchObject({ ok: true });

    const initial = await handler({
      type: 'plugin-manager.get-plugin-settings',
      pluginId: libraryPackage.pluginId,
      scope: 'library',
      libraryId: 'library-a',
    });
    expect(initial).toMatchObject({
      ok: true,
      sections: [{ id: 'palette-size', title: 'Palette size', type: 'number', value: null }],
    });

    await expect(handler({
      type: 'plugin-manager.set-plugin-setting',
      pluginId: libraryPackage.pluginId,
      scope: 'library',
      libraryId: 'library-a',
      settingId: 'palette-size',
      value: 16,
    })).resolves.toEqual({ ok: true, saved: true });

    const updated = await handler({
      type: 'plugin-manager.get-plugin-settings',
      pluginId: libraryPackage.pluginId,
      scope: 'library',
      libraryId: 'library-a',
    });
    expect(updated).toMatchObject({
      ok: true,
      sections: [{ id: 'palette-size', value: 16 }],
    });

    const settingsPath = path.join(library, '.serpent', 'plugin-settings', `${libraryPackage.pluginId}.json`);
    expect(readFileSync(settingsPath, 'utf8')).toContain('"palette-size": 16');

    const storagePath = path.join(library, '.serpent', 'plugin-data', `${libraryPackage.pluginId}.json`);
    expect(readFileSync(storagePath, 'utf8')).toContain('"settings.palette-size": 16');
  });
});
