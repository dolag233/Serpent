import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import { PluginStorageStore } from '../../src/main/plugin-storage-store';
import { runPluginGuestActivate } from '../../src/scripting/plugin-guest-realm';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';

const roots: string[] = [];
const FIXTURE = path.resolve('tests/fixtures/plugins/standard-host-probe');

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('fixed standard Host probe fixture', () => {
  it('installs and activates through guest realm into library storage', async () => {
    const userData = temporaryRoot('serpent-host-probe-user-');
    const library = temporaryRoot('serpent-host-probe-library-');
    const source = temporaryRoot('serpent-host-probe-source-');
    cpSync(FIXTURE, source, { recursive: true });

    const manager = new PluginPackageManager({
      userDataDirectory: userData,
      deviceId: 'probe-device',
      serpentVersion: '0.2.4',
      pluginApiVersion: 1,
      platform: 'darwin',
      arch: 'arm64',
      nodeAbi: 140,
    });
    const installed = await manager.installFromDirectory({
      directory: source,
      scope: 'library',
      libraryDirectory: library,
      source: { kind: 'local-directory', fingerprint: 'fixture:standard-host-probe' },
    });
    expect(installed.package.manifest.id).toBe('com.serpent.standard-host-probe');

    const storage = new PluginStorageStore(userData);
    const entryAbsolute = path.join(installed.package.packageDirectory, 'entry/main.js');
    const entryJavaScript = readFileSync(entryAbsolute, 'utf8');

    const result = await runPluginGuestActivate({
      entryJavaScript,
      executeAutomationCommand: async (commandId) => {
        expect(commandId).toBe('asset.search');
        return { items: [], total: 0, offset: 0, limit: 1, hasMore: false };
      },
      executeStorageOperation: async (input) => storage.execute({
        operation: input.operation,
        scope: input.scope ?? 'library',
        pluginId: 'com.serpent.standard-host-probe',
        libraryId: 'library-probe',
        libraryDirectory: library,
        permissions: ['library.read', 'storage.read', 'storage.write', 'asset.read'],
        ...(input.key === undefined ? {} : { key: input.key }),
        ...(input.value === undefined ? {} : { value: input.value }),
      }),
      waitUntilDeactivate: async () => undefined,
    });

    expect(result.ok).toBe(true);
    const document = JSON.parse(readFileSync(
      path.join(library, PLUGIN_LIBRARY_DATA_DIRECTORY, 'com.serpent.standard-host-probe.json'),
      'utf8',
    )) as { values: Record<string, unknown> };
    expect(document.values['host-probe']).toEqual({
      activated: true,
      source: 'standard-host-probe',
      previous: null,
    });
  });
});
