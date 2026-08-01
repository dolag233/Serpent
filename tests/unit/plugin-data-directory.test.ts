import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PLUGIN_FILES_DIRECTORY_NAME,
  resolvePluginDataDirectory,
} from '../../src/plugins/plugin-data-directory';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('plugin data directories', () => {
  it('creates a user-scoped directory below userData and validates containment', () => {
    const userDataDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-user-data-'));
    roots.push(userDataDirectory);

    const resolved = resolvePluginDataDirectory({
      scope: 'user',
      pluginId: 'com.example.model',
      userDataDirectory,
      libraryDirectory: null,
    });

    expect(resolved).toBe(path.join(userDataDirectory, PLUGIN_FILES_DIRECTORY_NAME, 'com.example.model'));
    expect(existsSync(resolved)).toBe(true);
    expect(path.relative(userDataDirectory, resolved).startsWith('..')).toBe(false);
  });

  it('creates a library-scoped directory below the library root', () => {
    const userDataDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-user-data-'));
    const libraryDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-plugin-library-'));
    roots.push(userDataDirectory, libraryDirectory);

    const resolved = resolvePluginDataDirectory({
      scope: 'library',
      pluginId: 'com.example.model',
      userDataDirectory,
      libraryDirectory,
    });

    expect(resolved).toBe(path.join(libraryDirectory, '.serpent', PLUGIN_FILES_DIRECTORY_NAME, 'com.example.model'));
    expect(existsSync(resolved)).toBe(true);
    expect(path.relative(libraryDirectory, resolved).startsWith('..')).toBe(false);
  });

  it('rejects a library scope without an open library', () => {
    expect(() => resolvePluginDataDirectory({
      scope: 'library',
      pluginId: 'com.example.model',
      userDataDirectory: '/tmp/user-data',
      libraryDirectory: null,
    })).toThrow('An open library is required');
  });
});
