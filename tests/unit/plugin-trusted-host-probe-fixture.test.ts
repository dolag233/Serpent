import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import { PluginStorageStore } from '../../src/main/plugin-storage-store';
import { createPluginTrustedHostHandler } from '../../src/scripting/plugin-trusted-host';
import { PLUGIN_LIBRARY_DATA_DIRECTORY } from '../../src/plugins/plugin-package';
import type { PluginTrustedChildMessage } from '../../src/shared/plugin-trusted-runtime-protocol';

const roots: string[] = [];
const FIXTURE = path.resolve('tests/fixtures/plugins/trusted-host-probe');

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function flush(ms = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('fixed trusted Host probe fixture', () => {
  it('installs and activates through the trusted Node Host into library storage', async () => {
    const userData = temporaryRoot('serpent-trusted-probe-user-');
    const library = temporaryRoot('serpent-trusted-probe-library-');
    const source = temporaryRoot('serpent-trusted-probe-source-');
    cpSync(FIXTURE, source, { recursive: true });

    const manager = new PluginPackageManager({
      userDataDirectory: userData,
      deviceId: 'trusted-probe-device',
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
      source: { kind: 'local-directory', fingerprint: 'fixture:trusted-host-probe' },
    });
    expect(installed.package.manifest.id).toBe('com.serpent.trusted-host-probe');
    expect(installed.package.manifest.runtime.mode).toBe('trusted');
    expect(existsSync(path.join(installed.package.packageDirectory, 'entry/main.js'))).toBe(true);

    const storage = new PluginStorageStore(userData);
    const permissions = ['library.read', 'asset.read', 'storage.read', 'storage.write'] as const;
    const posted: PluginTrustedChildMessage[] = [];
    const handler = createPluginTrustedHostHandler({
      postMessage: (message) => {
        posted.push(message);
        if (message.type === 'plugin-trusted.host-command') {
          queueMicrotask(() => {
            handler.handle({
              type: 'plugin-trusted.host-result',
              instanceId: message.instanceId,
              requestId: message.requestId,
              ok: true,
              result: { items: [], total: 0, offset: 0, limit: 1, hasMore: false },
            });
          });
          return;
        }
        if (message.type === 'plugin-trusted.storage-request') {
          queueMicrotask(() => {
            void storage.execute({
              operation: message.operation,
              scope: message.scope,
              pluginId: 'com.serpent.trusted-host-probe',
              libraryId: 'library-trusted-probe',
              libraryDirectory: library,
              permissions: [...permissions],
              ...(message.key === undefined ? {} : { key: message.key }),
              ...(message.value === undefined ? {} : { value: message.value }),
            }).then((result) => {
              handler.handle({
                type: 'plugin-trusted.storage-result',
                instanceId: message.instanceId,
                requestId: message.requestId,
                ok: true,
                result,
              });
            }, (error: unknown) => {
              handler.handle({
                type: 'plugin-trusted.storage-result',
                instanceId: message.instanceId,
                requestId: message.requestId,
                ok: false,
                error: {
                  code: 'STORAGE_FAILED',
                  message: error instanceof Error ? error.message : 'storage failed',
                },
              });
            });
          });
        }
      },
      heartbeatIntervalMs: 60_000,
    });

    const instanceId = '22222222-2222-4222-8222-222222222222';
    handler.handle({
      type: 'plugin-trusted.activate',
      instanceId,
      libraryId: 'library-trusted-probe',
      pluginId: 'com.serpent.trusted-host-probe',
      version: '1.0.0',
      packageHash: installed.package.lock.packageHash,
      packageDirectory: installed.package.packageDirectory,
      entryRelativePath: 'entry/main.js',
      permissions: [...permissions],
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 400 && !posted.some((message) => message.type === 'plugin-trusted.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-trusted.activated')).toBe(true);

    const document = JSON.parse(readFileSync(
      path.join(library, PLUGIN_LIBRARY_DATA_DIRECTORY, 'com.serpent.trusted-host-probe.json'),
      'utf8',
    )) as { values: Record<string, unknown> };
    expect(document.values['host-probe']).toEqual({
      activated: true,
      source: 'trusted-host-probe',
    });

    handler.handle({
      type: 'plugin-trusted.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-trusted.deactivated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-trusted.deactivated')).toBe(true);
    handler.dispose();
  });
});
