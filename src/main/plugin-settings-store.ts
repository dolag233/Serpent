import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { pluginIdSchema, type PluginManifest } from '../plugins/plugin-manifest';
import { PLUGIN_LIBRARY_SETTINGS_DIRECTORY } from '../plugins/plugin-package';

const SETTINGS_FILE_VERSION = 1 as const;
const MAX_SETTINGS_FILE_BYTES = 64 * 1024;
const settingIdSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u);
const settingValueSchema = z.union([
  z.boolean(),
  z.number().finite(),
  z.string().max(8_192),
]);

const settingsDocumentSchema = z.strictObject({
  version: z.literal(SETTINGS_FILE_VERSION),
  pluginId: pluginIdSchema,
  values: z.record(settingIdSchema, settingValueSchema).refine((value) => Object.keys(value).length <= 128, {
    message: 'A plugin settings document can contain at most 128 values.',
  }),
});

export type PluginSettingValue = z.infer<typeof settingValueSchema>;
export type PluginSettingsLayer = 'user-default' | 'library' | 'device-override';
export type PluginSettingsDocument = z.infer<typeof settingsDocumentSchema>;

export class PluginSettingsStoreError extends Error {
  constructor(
    readonly code: 'PLUGIN_SETTINGS_INVALID' | 'PLUGIN_SETTING_UNDECLARED' | 'PLUGIN_SETTING_VALUE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'PluginSettingsStoreError';
  }
}

export type PluginSettingsSnapshot = {
  values: Record<string, PluginSettingValue>;
  sources: Record<string, PluginSettingsLayer>;
};

/**
 * Owns non-secret plugin settings outside the library database. The resource
 * layer is deliberately ordinary JSON under `.serpent/` so personal device
 * synchronization carries it; trust, crash state and device overrides never
 * use that path.
 */
export class PluginSettingsStore {
  constructor(private readonly userDataDirectory: string) {}

  async getEffective(input: {
    libraryId: string;
    libraryDirectory: string;
    manifest: PluginManifest;
  }): Promise<PluginSettingsSnapshot> {
    const [userDefaults, librarySettings, deviceOverrides] = await Promise.all([
      this.#readLayer('user-default', input),
      this.#readLayer('library', input),
      this.#readLayer('device-override', input),
    ]);
    const values: Record<string, PluginSettingValue> = {};
    const sources: Record<string, PluginSettingsLayer> = {};
    for (const [layer, document] of [
      ['user-default', userDefaults],
      ['library', librarySettings],
      ['device-override', deviceOverrides],
    ] as const) {
      for (const [settingId, value] of Object.entries(document.values)) {
        values[settingId] = value;
        sources[settingId] = layer;
      }
    }
    return { values, sources };
  }

  async set(input: {
    layer: PluginSettingsLayer;
    libraryId: string;
    libraryDirectory: string;
    manifest: PluginManifest;
    settingId: string;
    value: PluginSettingValue;
  }): Promise<PluginSettingsSnapshot> {
    this.#assertValue(input.manifest, input.settingId, input.value);
    const document = await this.#readLayer(input.layer, input);
    document.values[input.settingId] = input.value;
    await this.#writeLayer(input.layer, input, document);
    return this.getEffective(input);
  }

  async clear(input: {
    layer: PluginSettingsLayer;
    libraryId: string;
    libraryDirectory: string;
    manifest: PluginManifest;
    settingId: string;
  }): Promise<PluginSettingsSnapshot> {
    this.#assertDeclared(input.manifest, input.settingId);
    const document = await this.#readLayer(input.layer, input);
    delete document.values[input.settingId];
    await this.#writeLayer(input.layer, input, document);
    return this.getEffective(input);
  }

  #assertDeclared(manifest: PluginManifest, settingId: string): PluginManifest['contributes']['settings'][number] {
    const parsedSettingId = settingIdSchema.safeParse(settingId);
    const setting = parsedSettingId.success
      ? manifest.contributes.settings.find((candidate) => candidate.id === parsedSettingId.data)
      : undefined;
    if (setting === undefined) {
      throw new PluginSettingsStoreError('PLUGIN_SETTING_UNDECLARED', 'The plugin did not declare this setting.');
    }
    return setting;
  }

  #assertValue(manifest: PluginManifest, settingId: string, value: PluginSettingValue): void {
    const setting = this.#assertDeclared(manifest, settingId);
    const isExpectedType = setting.type === 'boolean'
      ? typeof value === 'boolean'
      : setting.type === 'number'
        ? typeof value === 'number'
        : typeof value === 'string';
    if (!isExpectedType) {
      throw new PluginSettingsStoreError('PLUGIN_SETTING_VALUE_INVALID', 'The setting value does not match the declared type.');
    }
    if (setting.type === 'select'
      && !setting.options?.some((option) => option.value === value)) {
      throw new PluginSettingsStoreError('PLUGIN_SETTING_VALUE_INVALID', 'The setting value is not one of the declared options.');
    }
  }

  #emptyDocument(pluginId: string): PluginSettingsDocument {
    return { version: SETTINGS_FILE_VERSION, pluginId, values: {} };
  }

  async #readLayer(
    layer: PluginSettingsLayer,
    input: { libraryId: string; libraryDirectory: string; manifest: PluginManifest },
  ): Promise<PluginSettingsDocument> {
    const settingsPath = this.#pathFor(layer, input);
    let contents: string;
    try {
      contents = await readFile(settingsPath, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.#emptyDocument(input.manifest.id);
      throw error;
    }
    if (Buffer.byteLength(contents, 'utf8') > MAX_SETTINGS_FILE_BYTES) {
      throw new PluginSettingsStoreError('PLUGIN_SETTINGS_INVALID', 'The plugin settings file exceeds the supported size.');
    }
    try {
      const document = settingsDocumentSchema.parse(JSON.parse(contents));
      if (document.pluginId !== input.manifest.id) {
        throw new PluginSettingsStoreError('PLUGIN_SETTINGS_INVALID', 'The plugin settings file belongs to another plugin.');
      }
      const values: PluginSettingsDocument['values'] = {};
      for (const [settingId, value] of Object.entries(document.values)) {
        const declared = input.manifest.contributes.settings.some((setting) => setting.id === settingId);
        if (!declared) continue;
        try {
          this.#assertValue(input.manifest, settingId, value);
        } catch (error) {
          // Stale values from older plugin versions must not wipe the whole
          // settings document; skip them so the UI can fall back to defaults.
          if (error instanceof PluginSettingsStoreError
            && error.code === 'PLUGIN_SETTING_VALUE_INVALID') {
            continue;
          }
          throw error;
        }
        values[settingId] = value;
      }
      return { ...document, values };
    } catch (error) {
      if (error instanceof PluginSettingsStoreError) throw error;
      throw new PluginSettingsStoreError('PLUGIN_SETTINGS_INVALID', 'The plugin settings file is invalid.');
    }
  }

  async #writeLayer(
    layer: PluginSettingsLayer,
    input: { libraryId: string; libraryDirectory: string; manifest: PluginManifest },
    document: PluginSettingsDocument,
  ): Promise<void> {
    const settingsPath = this.#pathFor(layer, input);
    const contents = `${JSON.stringify(settingsDocumentSchema.parse(document), null, 2)}\n`;
    if (Buffer.byteLength(contents, 'utf8') > MAX_SETTINGS_FILE_BYTES) {
      throw new PluginSettingsStoreError('PLUGIN_SETTINGS_INVALID', 'The plugin settings file exceeds the supported size.');
    }
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const stagingPath = `${settingsPath}.staging-${randomUUID()}`;
    try {
      await writeFile(stagingPath, contents, { encoding: 'utf8', mode: 0o600 });
      await rename(stagingPath, settingsPath);
    } finally {
      await rm(stagingPath, { force: true });
    }
  }

  #pathFor(
    layer: PluginSettingsLayer,
    input: { libraryId: string; libraryDirectory: string; manifest: PluginManifest },
  ): string {
    if (layer === 'library') {
      return path.join(input.libraryDirectory, PLUGIN_LIBRARY_SETTINGS_DIRECTORY, `${input.manifest.id}.json`);
    }
    const baseDirectory = layer === 'user-default'
      ? path.join(this.userDataDirectory, 'plugin-settings', 'defaults')
      : path.join(
        this.userDataDirectory,
        'plugin-settings',
        'overrides',
        createHash('sha256').update(input.libraryId).digest('hex'),
      );
    return path.join(baseDirectory, `${input.manifest.id}.json`);
  }
}
