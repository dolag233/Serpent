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
      diagnostics: [],
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
      diagnostics: [],
    });
    expect(readFileSync(path.join(copiedLibrary, '.serpent', 'plugin-lock.json'), 'utf8'))
      .not.toContain(path.basename(userA));
  });

  it.each([
    ['boolean', 'enabled', 'yes'],
    ['number', 'palette-size', 'large'],
    ['string', 'label', 42],
    ['select', 'quality', 42],
  ] as const)('rejects %s setting values with the wrong runtime type', async (_type, settingId, value) => {
    const library = temporaryRoot('serpent-plugin-settings-library-');
    const userData = temporaryRoot('serpent-plugin-settings-user-');
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        settings: [
          { id: 'enabled', title: 'Enabled', type: 'boolean', default: true },
          { id: 'palette-size', title: 'Palette size', type: 'number', default: 4 },
          { id: 'label', title: 'Label', type: 'string', default: 'Default' },
          {
            id: 'quality',
            title: 'Quality',
            type: 'select',
            default: 'fast',
            options: [{ value: 'fast', label: 'Fast' }, { value: 'high', label: 'High' }],
          },
        ],
      },
    });
    const store = new PluginSettingsStore(userData);
    const input = { libraryId: 'library-a', libraryDirectory: library, manifest, layer: 'library' as const };

    await expect(store.set({ ...input, settingId, value }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_VALUE_INVALID' });
  });

  it('rejects undeclared settings', async () => {
    const library = temporaryRoot('serpent-plugin-settings-library-');
    const userData = temporaryRoot('serpent-plugin-settings-user-');
    const manifest = pluginManifestSchema.parse(manifestFixture);
    const store = new PluginSettingsStore(userData);
    const input = { libraryId: 'library-a', libraryDirectory: library, manifest, layer: 'library' as const };

    await expect(store.set({ ...input, settingId: 'missing-setting', value: 2 }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_UNDECLARED' });
  });

  it('rejects select values outside the declared options', async () => {
    const library = temporaryRoot('serpent-plugin-select-library-');
    const userData = temporaryRoot('serpent-plugin-select-user-');
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        settings: [{
          id: 'quality',
          title: 'Quality',
          type: 'select',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'high', label: 'High' },
          ],
        }],
      },
    });
    const store = new PluginSettingsStore(userData);
    const input = { libraryId: 'library-a', libraryDirectory: library, manifest, layer: 'library' as const };

    await expect(store.set({ ...input, settingId: 'quality', value: 'high' }))
      .resolves.toMatchObject({ values: { quality: 'high' } });
    await expect(store.set({ ...input, settingId: 'quality', value: 'ultra' }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_VALUE_INVALID' });
  });

  it('rejects numbers outside the declared range', async () => {
    const library = temporaryRoot('serpent-plugin-number-range-library-');
    const userData = temporaryRoot('serpent-plugin-number-range-user-');
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        settings: [{
          id: 'quality',
          title: 'Quality',
          type: 'number',
          default: 4,
          minimum: 1,
          maximum: 8,
        }],
      },
    });
    const store = new PluginSettingsStore(userData);
    const input = { libraryId: 'library-a', libraryDirectory: library, manifest, layer: 'library' as const };

    await expect(store.set({ ...input, settingId: 'quality', value: 0 }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_VALUE_INVALID' });
    await expect(store.set({ ...input, settingId: 'quality', value: 9 }))
      .rejects.toMatchObject({ code: 'PLUGIN_SETTING_VALUE_INVALID' });
  });

  it('skips stale invalid select values when reading an existing settings document', async () => {
    const library = temporaryRoot('serpent-plugin-select-stale-library-');
    const userData = temporaryRoot('serpent-plugin-select-stale-user-');
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        settings: [{
          id: 'quality',
          title: 'Quality',
          type: 'select',
          default: 'high',
          options: [
            { value: 'fast', label: 'Fast' },
            { value: 'high', label: 'High' },
          ],
        }],
      },
    });
    const store = new PluginSettingsStore(userData);
    const defaultsDirectory = path.join(userData, 'plugin-settings', 'defaults');
    mkdirSync(defaultsDirectory, { recursive: true });
    writeFileSync(
      path.join(defaultsDirectory, `${manifest.id}.json`),
      `${JSON.stringify({
        version: 1,
        pluginId: manifest.id,
        values: {
          quality: '',
          'removed-setting': true,
        },
      }, null, 2)}\n`,
    );

    await expect(store.getEffective({
      libraryId: 'library-a',
      libraryDirectory: library,
      manifest,
    })).resolves.toEqual({
      values: { quality: 'high' },
      sources: {},
      diagnostics: [{
        settingId: 'quality',
        layer: 'user-default',
        code: 'invalid-option',
        message: 'The setting value is not one of the declared options.',
      }],
    });
  });

  it('falls back per field, reports diagnostics, and preserves undeclared values on later writes', async () => {
    const library = temporaryRoot('serpent-plugin-settings-diagnostics-library-');
    const userData = temporaryRoot('serpent-plugin-settings-diagnostics-user-');
    const manifest = pluginManifestSchema.parse({
      ...manifestFixture,
      contributes: {
        ...manifestFixture.contributes,
        settings: [
          { id: 'enabled', title: 'Enabled', type: 'boolean', default: true },
          { id: 'batch-size', title: 'Batch size', type: 'number', default: 4, minimum: 1, maximum: 8 },
          { id: 'batch-size-type', title: 'Batch size type', type: 'number', default: 2 },
          { id: 'label', title: 'Label', type: 'string', default: 'Default' },
          { id: 'description', title: 'Description', type: 'string', default: 'Default description' },
          {
            id: 'quality',
            title: 'Quality',
            type: 'select',
            default: 'fast',
            options: [{ value: 'fast', label: 'Fast' }, { value: 'high', label: 'High' }],
          },
          {
            id: 'quality-type',
            title: 'Quality type',
            type: 'select',
            default: 'fast',
            options: [{ value: 'fast', label: 'Fast' }, { value: 'high', label: 'High' }],
          },
        ],
      },
    });
    const settingsDirectory = path.join(library, '.serpent', 'plugin-settings');
    mkdirSync(settingsDirectory, { recursive: true });
    const settingsPath = path.join(settingsDirectory, `${manifest.id}.json`);
    writeFileSync(settingsPath, `${JSON.stringify({
      version: 1,
      pluginId: manifest.id,
      values: {
        enabled: 'yes',
        'batch-size': 99,
        'batch-size-type': 'many',
        label: true,
        description: 'Persisted description',
        quality: 'ultra',
        'quality-type': 42,
        'removed-setting': true,
      },
    }, null, 2)}\n`);
    const store = new PluginSettingsStore(userData);
    const input = { libraryId: 'library-a', libraryDirectory: library, manifest };

    await expect(store.getEffective(input)).resolves.toEqual({
      values: {
        enabled: true,
        'batch-size': 4,
        'batch-size-type': 2,
        label: 'Default',
        description: 'Persisted description',
        quality: 'fast',
        'quality-type': 'fast',
      },
      sources: { description: 'library' },
      diagnostics: [
        {
          settingId: 'enabled',
          layer: 'library',
          code: 'invalid-type',
          message: 'The setting value must be a boolean.',
        },
        {
          settingId: 'batch-size',
          layer: 'library',
          code: 'out-of-range',
          message: 'The setting value is outside the declared range.',
        },
        {
          settingId: 'batch-size-type',
          layer: 'library',
          code: 'invalid-type',
          message: 'The setting value must be a number.',
        },
        {
          settingId: 'label',
          layer: 'library',
          code: 'invalid-type',
          message: 'The setting value must be a string.',
        },
        {
          settingId: 'quality',
          layer: 'library',
          code: 'invalid-option',
          message: 'The setting value is not one of the declared options.',
        },
        {
          settingId: 'quality-type',
          layer: 'library',
          code: 'invalid-type',
          message: 'The setting value must be a string.',
        },
      ],
    });

    expect((await store.getEffective(input)).values).not.toHaveProperty('removed-setting');

    await store.set({ ...input, layer: 'library', settingId: 'label', value: 'Updated label' });
    const written = readFileSync(settingsPath, 'utf8');
    expect(written).toContain('"removed-setting": true');
    expect(written).toContain('"enabled": "yes"');
    expect(written).toContain('"label": "Updated label"');
  });
});
