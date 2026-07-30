import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { pluginIdSchema } from '../plugins/plugin-manifest';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../plugins/plugin-package';

const STORAGE_FILE_VERSION = 1 as const;
const MAX_STORAGE_FILE_BYTES = 64 * 1024;
const MAX_KEYS = 256;
const storageKeySchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$/u);
const storageValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string().max(8_192),
  z.array(z.unknown()).max(256),
  z.record(z.string().max(128), z.unknown()),
]);

const storageDocumentSchema = z.strictObject({
  version: z.literal(STORAGE_FILE_VERSION),
  pluginId: pluginIdSchema,
  values: z.record(storageKeySchema, storageValueSchema).refine(
    (value) => Object.keys(value).length <= MAX_KEYS,
    { message: `A plugin storage document can contain at most ${MAX_KEYS} keys.` },
  ),
});

export type PluginStorageScope = 'library' | 'user';
export type PluginStorageValue = z.infer<typeof storageValueSchema>;
export type PluginStorageDocument = z.infer<typeof storageDocumentSchema>;

export class PluginStorageStoreError extends Error {
  constructor(
    readonly code:
      | 'PLUGIN_STORAGE_INVALID'
      | 'PLUGIN_STORAGE_KEY_INVALID'
      | 'PLUGIN_STORAGE_VALUE_INVALID'
      | 'PLUGIN_STORAGE_PERMISSION',
    message: string,
  ) {
    super(message);
    this.name = 'PluginStorageStoreError';
  }
}

/**
 * Namespaced KV storage for plugins. Library scope lives under `.serpent/` so it
 * can sync with the library; user scope stays in userData and never syncs.
 * Secrets must not use this store.
 */
export class PluginStorageStore {
  constructor(private readonly userDataDirectory: string) {}

  async get(input: {
    scope: PluginStorageScope;
    pluginId: string;
    libraryId: string;
    libraryDirectory: string;
    key: string;
  }): Promise<PluginStorageValue | null> {
    const key = this.#parseKey(input.key);
    const document = await this.#read(input);
    return document.values[key] ?? null;
  }

  async set(input: {
    scope: PluginStorageScope;
    pluginId: string;
    libraryId: string;
    libraryDirectory: string;
    key: string;
    value: unknown;
  }): Promise<void> {
    const key = this.#parseKey(input.key);
    const value = this.#parseValue(input.value);
    const document = await this.#read(input);
    document.values[key] = value;
    await this.#write(input, document);
  }

  async delete(input: {
    scope: PluginStorageScope;
    pluginId: string;
    libraryId: string;
    libraryDirectory: string;
    key: string;
  }): Promise<boolean> {
    const key = this.#parseKey(input.key);
    const document = await this.#read(input);
    if (!(key in document.values)) return false;
    delete document.values[key];
    await this.#write(input, document);
    return true;
  }

  async listKeys(input: {
    scope: PluginStorageScope;
    pluginId: string;
    libraryId: string;
    libraryDirectory: string;
  }): Promise<string[]> {
    const document = await this.#read(input);
    return Object.keys(document.values).sort();
  }

  async execute(input: {
    operation: 'get' | 'set' | 'delete' | 'list';
    scope: PluginStorageScope;
    pluginId: string;
    libraryId: string;
    libraryDirectory: string;
    key?: string;
    value?: unknown;
    permissions: readonly string[];
  }): Promise<unknown> {
    const needsWrite = input.operation === 'set' || input.operation === 'delete';
    const required = needsWrite ? 'storage.write' : 'storage.read';
    if (!input.permissions.includes(required)) {
      throw new PluginStorageStoreError(
        'PLUGIN_STORAGE_PERMISSION',
        `This plugin did not declare the ${required} permission.`,
      );
    }
    if (input.operation === 'list') {
      return { keys: await this.listKeys(input) };
    }
    if (input.key === undefined) {
      throw new PluginStorageStoreError('PLUGIN_STORAGE_KEY_INVALID', 'This storage operation requires a key.');
    }
    if (input.operation === 'get') {
      return { value: await this.get({ ...input, key: input.key }) };
    }
    if (input.operation === 'delete') {
      return { deleted: await this.delete({ ...input, key: input.key }) };
    }
    await this.set({ ...input, key: input.key, value: input.value });
    return { ok: true };
  }

  #parseKey(key: string): string {
    const parsed = storageKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new PluginStorageStoreError('PLUGIN_STORAGE_KEY_INVALID', 'Plugin storage keys must be short lowercase identifiers.');
    }
    return parsed.data;
  }

  #parseValue(value: unknown): PluginStorageValue {
    const parsed = storageValueSchema.safeParse(value);
    if (!parsed.success) {
      throw new PluginStorageStoreError(
        'PLUGIN_STORAGE_VALUE_INVALID',
        'Plugin storage values must be JSON-safe and within size limits.',
      );
    }
    return parsed.data;
  }

  async #read(input: {
    scope: PluginStorageScope;
    pluginId: string;
    libraryId: string;
    libraryDirectory: string;
  }): Promise<PluginStorageDocument> {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    const storagePath = this.#pathFor(input.scope, pluginId, input);
    try {
      const raw = await readFile(storagePath, 'utf8');
      if (Buffer.byteLength(raw, 'utf8') > MAX_STORAGE_FILE_BYTES) {
        throw new PluginStorageStoreError('PLUGIN_STORAGE_INVALID', 'Plugin storage document exceeds the size limit.');
      }
      return storageDocumentSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof PluginStorageStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: STORAGE_FILE_VERSION, pluginId, values: {} };
      }
      throw new PluginStorageStoreError('PLUGIN_STORAGE_INVALID', 'Plugin storage document could not be read.');
    }
  }

  async #write(
    input: {
      scope: PluginStorageScope;
      pluginId: string;
      libraryId: string;
      libraryDirectory: string;
    },
    document: PluginStorageDocument,
  ): Promise<void> {
    const pluginId = pluginIdSchema.parse(input.pluginId);
    const next = storageDocumentSchema.parse({
      version: STORAGE_FILE_VERSION,
      pluginId,
      values: document.values,
    });
    const contents = `${JSON.stringify(next, null, 2)}\n`;
    if (Buffer.byteLength(contents, 'utf8') > MAX_STORAGE_FILE_BYTES) {
      throw new PluginStorageStoreError('PLUGIN_STORAGE_INVALID', 'Plugin storage document exceeds the size limit.');
    }
    const storagePath = this.#pathFor(input.scope, pluginId, input);
    await mkdir(path.dirname(storagePath), { recursive: true });
    const stagingPath = `${storagePath}.staging-${randomUUID()}`;
    try {
      await writeFile(stagingPath, contents, { encoding: 'utf8', mode: 0o600 });
      await rename(stagingPath, storagePath);
    } finally {
      await rm(stagingPath, { force: true });
    }
  }

  #pathFor(
    scope: PluginStorageScope,
    pluginId: string,
    input: { libraryId: string; libraryDirectory: string },
  ): string {
    if (scope === 'library') {
      return path.join(input.libraryDirectory, PLUGIN_LIBRARY_DATA_DIRECTORY, `${pluginId}.json`);
    }
    return path.join(this.userDataDirectory, 'plugin-storage', pluginId, 'user.json');
  }
}
