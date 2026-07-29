import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginSettingsStore } from '../../src/main/plugin-settings-store';
import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import { pluginManifestSchema } from '../../src/plugins/plugin-manifest';
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

describe('PluginSettingsStore', () => {
  it('synchronizes only the library layer when a library is copied to another device', async () => {
    const pluginSource = temporaryRoot('serpent-plugin-settings-source-');
    const sourceLibrary = temporaryRoot('serpent-plugin-settings-library-a-');
    const copiedLibrary = temporaryRoot('serpent-plugin-settings-library-b-');
    const userA = temporaryRoot('serpent-plugin-settings-user-a-');
    const userB = temporaryRoot('serpent-plugin-settings-user-b-');
    const manifest = pluginManifestSchema.parse(manifestFixture);
    const deviceA = new PluginSettingsStore(userA);
    const deviceB = new PluginSettingsStore(userB);
    writePlugin(pluginSource);
    const managerA = createManager(userA);
    const installed = await managerA.installFromDirectory({
      directory: pluginSource,
      scope: 'library',
      libraryDirectory: sourceLibrary,
      source: { kind: 'local-directory', fingerprint: 'source:stable' },
    });
    await managerA.recordTrust({ package: installed.package, decision: 'trusted' });
    const baseInput = {
      libraryId: 'library-a',
      libraryDirectory: sourceLibrary,
      manifest,
    };

    await deviceA.set({
      ...baseInput,
      layer: 'user-default',
      settingId: 'palette-size',
      value: 4,
    });
    await deviceA.set({
      ...baseInput,
      layer: 'library',
      settingId: 'palette-size',
      value: 8,
    });
    await deviceA.set({
      ...baseInput,
      layer: 'device-override',
      settingId: 'palette-size',
      value: 12,
    });
    await expect(deviceA.getEffective(baseInput)).resolves.toEqual({
      values: { 'palette-size': 12 },
      sources: { 'palette-size': 'device-override' },
    });

    rmSync(copiedLibrary, { recursive: true, force: true });
    cpSync(sourceLibrary, copiedLibrary, { recursive: true });
    const managerB = createManager(userB);
    await expect(managerB.listInstalled({ scope: 'library', libraryDirectory: copiedLibrary })).resolves.toMatchObject([{
      status: 'valid',
      package: { lock: { pluginId: manifest.id } },
      trust: undefined,
    }]);
    await expect(deviceB.getEffective({ ...baseInput, libraryDirectory: copiedLibrary })).resolves.toEqual({
      values: { 'palette-size': 8 },
      sources: { 'palette-size': 'library' },
    });
    expect(readFileSync(path.join(copiedLibrary, '.serpent', 'plugin-lock.json'), 'utf8'))
      .not.toContain(path.basename(userA));
  });

  it('rejects undeclared settings and values that do not match the manifest type', async () => {
    const library = temporaryRoot('serpent-plugin-settings-library-');
    const userData = temporaryRoot('serpent-plugin-settings-user-');
    const manifest = pluginManifestSchema.parse(manifestFixture);
    const store = new PluginSettingsStore(userData);
    const input = { libraryId: 'library-a', libraryDirectory: library, manifest, layer: 'library' as const };

    await expect(store.set({ ...input, settingId: 'missing-setting', value: 2 }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_UNDECLARED' });
    await expect(store.set({ ...input, settingId: 'palette-size', value: 'large' }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_VALUE_INVALID' });
  });
});
