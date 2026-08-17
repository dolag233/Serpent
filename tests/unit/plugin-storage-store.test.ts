import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PluginStorageStore,
} from '../../src/main/plugin-storage-store';
import type { PluginStorageStoreError } from '../../src/main/plugin-storage-store';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PluginStorageStore', () => {
  it('stores library-scoped values under .serpent and keeps user scope in userData', async () => {
    const userData = temporaryRoot('serpent-plugin-storage-user-');
    const library = temporaryRoot('serpent-plugin-storage-library-');
    const store = new PluginStorageStore(userData);

    await store.execute({
      operation: 'set',
      scope: 'library',
      pluginId: 'com.example.demo',
      libraryId: 'library-1',
      libraryDirectory: library,
      key: 'last-palette',
      value: { size: 8 },
      permissions: ['storage.write', 'storage.read'],
    });
    await store.execute({
      operation: 'set',
      scope: 'user',
      pluginId: 'com.example.demo',
      libraryId: 'library-1',
      libraryDirectory: library,
      key: 'window-width',
      value: 1200,
      permissions: ['storage.write', 'storage.read'],
    });

    const libraryPath = path.join(library, PLUGIN_LIBRARY_DATA_DIRECTORY, 'com.example.demo.json');
    const libraryDocument = JSON.parse(readFileSync(libraryPath, 'utf8')) as {
      values: Record<string, unknown>;
    };
    expect(libraryDocument.values['last-palette']).toEqual({ size: 8 });
    expect(libraryDocument.values['window-width']).toBeUndefined();

    const userPath = path.join(userData, 'plugin-storage', 'com.example.demo', 'user.json');
    const userDocument = JSON.parse(readFileSync(userPath, 'utf8')) as {
      values: Record<string, unknown>;
    };
    expect(userDocument.values['window-width']).toBe(1200);

    await expect(store.execute({
      operation: 'get',
      scope: 'library',
      pluginId: 'com.example.demo',
      libraryId: 'library-1',
      libraryDirectory: library,
      key: 'last-palette',
      permissions: ['storage.read'],
    })).resolves.toEqual({ value: { size: 8 } });
  });

  it('rejects storage writes without storage.write', async () => {
    const userData = temporaryRoot('serpent-plugin-storage-denied-');
    const library = temporaryRoot('serpent-plugin-storage-denied-library-');
    const store = new PluginStorageStore(userData);

    await expect(store.execute({
      operation: 'set',
      scope: 'library',
      pluginId: 'com.example.demo',
      libraryId: 'library-1',
      libraryDirectory: library,
      key: 'secret',
      value: true,
      permissions: ['storage.read'],
    })).rejects.toMatchObject({
      code: 'PLUGIN_STORAGE_PERMISSION',
    } satisfies Partial<PluginStorageStoreError>);
  });
});
