import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPluginTrustedHostHandler } from '../../src/scripting/plugin-trusted-host';
import type { PluginTrustedChildMessage } from '../../src/shared/plugin-trusted-runtime-protocol';
import { pluginTrustedParentMessageSchema } from '../../src/shared/plugin-trusted-runtime-protocol';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function flush(ms = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('plugin-trusted runtime protocol', () => {
  it('requires a package directory for trusted activate', () => {
    const parsed = pluginTrustedParentMessageSchema.parse({
      type: 'plugin-trusted.activate',
      instanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      pluginId: 'com.example.trusted',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      packageDirectory: '/plugins/trusted',
      entryRelativePath: 'dist/main.js',
      permissions: ['library.read', 'asset.read'],
    });
    expect(parsed.type).toBe('plugin-trusted.activate');
  });
});

describe('Plugin Trusted Host handler', () => {
  it('loads a CommonJS entry from a package directory and parks until deactivate', async () => {
    const packageDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-trusted-plugin-'));
    roots.push(packageDirectory);
    mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
    writeFileSync(path.join(packageDirectory, 'dist', 'main.js'), `
      exports.activate = async function activate(serpent) {
        await serpent.assets.search({ query: null, limit: 1 });
      };
      exports.deactivate = async function deactivate() {};
    `);

    const posted: PluginTrustedChildMessage[] = [];
    const handler = createPluginTrustedHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';
    handler.handle({
      type: 'plugin-trusted.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.trusted',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      packageDirectory,
      entryRelativePath: 'dist/main.js',
      permissions: ['library.read', 'asset.read'],
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-trusted.host-command'); attempt += 1) {
      await flush(10);
    }
    const hostCommand = posted.find((message) => message.type === 'plugin-trusted.host-command');
    expect(hostCommand).toMatchObject({
      type: 'plugin-trusted.host-command',
      commandId: 'asset.search',
    });
    if (hostCommand?.type !== 'plugin-trusted.host-command') throw new Error('missing host command');

    handler.handle({
      type: 'plugin-trusted.host-result',
      instanceId,
      requestId: hostCommand.requestId,
      ok: true,
      result: { items: [], total: 0, offset: 0, limit: 1, hasMore: false },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-trusted.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-trusted.activated')).toBe(true);

    handler.handle({
      type: 'plugin-trusted.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-trusted.deactivated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => (
      message.type === 'plugin-trusted.deactivated' && message.reason === 'library-closed'
    ))).toBe(true);
    handler.dispose();
  }, 20_000);
});
