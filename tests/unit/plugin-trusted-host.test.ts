import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPluginTrustedHostHandler } from '../../src/scripting/plugin-trusted-host';
import {
  SERPENT_GUEST_ASSET_METHODS,
  SERPENT_GUEST_COLLECTION_METHODS,
  SERPENT_GUEST_FILE_METHODS,
  SERPENT_GUEST_FOLDER_METHODS,
  SERPENT_GUEST_LIBRARY_METHODS,
  SERPENT_GUEST_LINKED_FOLDER_METHODS,
  SERPENT_GUEST_PALETTE_METHODS,
  SERPENT_GUEST_SMART_COLLECTION_METHODS,
  SERPENT_GUEST_TAG_METHODS,
  SERPENT_GUEST_TRASH_METHODS,
} from '../../src/scripting/serpent-guest-api';
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
  it('exposes the shared Guest API Gateway method sets', async () => {
    const packageDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-trusted-guest-api-'));
    roots.push(packageDirectory);
    mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
    writeFileSync(path.join(packageDirectory, 'dist', 'main.js'), `
        exports.setup = async function setup(serpent) {
        serpent.console.log(JSON.stringify({
          assets: Object.keys(serpent.assets).sort(),
          library: Object.keys(serpent.library).sort(),
          folders: Object.keys(serpent.folders).sort(),
          tags: Object.keys(serpent.tags).sort(),
          collections: Object.keys(serpent.collections).sort(),
          smartCollections: Object.keys(serpent.smartCollections).sort(),
          linkedFolders: Object.keys(serpent.linkedFolders).sort(),
          files: Object.keys(serpent.files).sort(),
          trash: Object.keys(serpent.trash).sort(),
          palettes: Object.keys(serpent.palettes).sort()
        }));
      };
      exports.dispose = async function dispose() {};
    `);

    const posted: PluginTrustedChildMessage[] = [];
    const handler = createPluginTrustedHostHandler({
      postMessage: (message) => posted.push(message),
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    handler.handle({
      type: 'plugin-trusted.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.guest-api',
      version: '1.0.0',
      packageHash: 'c'.repeat(64),
      packageDirectory,
      entryRelativePath: 'dist/main.js',
      permissions: [],
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-trusted.activated'); attempt += 1) {
      await flush(10);
    }
    const consoleMessage = posted.find((message) => message.type === 'plugin-trusted.console');
    expect(consoleMessage?.type).toBe('plugin-trusted.console');
    if (consoleMessage?.type !== 'plugin-trusted.console') throw new Error('missing Guest API probe output');
    expect(JSON.parse(consoleMessage.message)).toEqual({
      assets: [...SERPENT_GUEST_ASSET_METHODS].sort(),
      library: [...SERPENT_GUEST_LIBRARY_METHODS].sort(),
      folders: [...SERPENT_GUEST_FOLDER_METHODS].sort(),
      tags: [...SERPENT_GUEST_TAG_METHODS].sort(),
      collections: [...SERPENT_GUEST_COLLECTION_METHODS].sort(),
      smartCollections: [...SERPENT_GUEST_SMART_COLLECTION_METHODS].sort(),
      linkedFolders: [...SERPENT_GUEST_LINKED_FOLDER_METHODS].sort(),
      files: [...SERPENT_GUEST_FILE_METHODS].sort(),
      trash: [...SERPENT_GUEST_TRASH_METHODS].sort(),
      palettes: [...SERPENT_GUEST_PALETTE_METHODS].sort(),
    });

    handler.handle({
      type: 'plugin-trusted.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    handler.dispose();
  }, 20_000);

  it('loads a CommonJS entry from a package directory and parks until deactivate', async () => {
    const packageDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-trusted-plugin-'));
    roots.push(packageDirectory);
    mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
    writeFileSync(path.join(packageDirectory, 'dist', 'main.js'), `
        exports.setup = async function setup(serpent) {
        await serpent.assets.search({ query: null, limit: 1 });
      };
        exports.dispose = async function dispose(reason) {
          serpent.console.log(`disposed:${reason}`);
        };
    `);

    const posted: PluginTrustedChildMessage[] = [];
    const handler = createPluginTrustedHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
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
    expect(posted.some((message) => (
      message.type === 'plugin-trusted.console' && message.message === 'disposed:library-closed'
    ))).toBe(true);
    handler.dispose();
  }, 20_000);

  it('exposes bounded content read and replacement through the Gateway bridge', async () => {
    const packageDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-trusted-content-plugin-'));
    roots.push(packageDirectory);
    mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
    writeFileSync(path.join(packageDirectory, 'dist', 'main.js'), `
        exports.setup = async function setup(serpent) {
        await serpent.assets.readContent('asset-1', { maxBytes: 4 });
        await serpent.assets.replaceContent('asset-1', 'AQID', { expectedRevisionId: 'revision-1' });
      };
        exports.dispose = async function dispose() {};
    `);

    const posted: PluginTrustedChildMessage[] = [];
    const handler = createPluginTrustedHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = '77777777-7777-4777-8777-777777777777';
    handler.handle({
      type: 'plugin-trusted.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.content',
      version: '1.0.0',
      packageHash: 'b'.repeat(64),
      packageDirectory,
      entryRelativePath: 'dist/main.js',
      permissions: ['library.read', 'asset.read', 'content.read', 'content.write'],
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => (
      message.type === 'plugin-trusted.host-command' && message.commandId === 'asset.content.read'
    )); attempt += 1) {
      await flush(10);
    }
    const readCommand = posted.find((message) => (
      message.type === 'plugin-trusted.host-command' && message.commandId === 'asset.content.read'
    ));
    expect(readCommand).toMatchObject({
      commandId: 'asset.content.read',
      input: { assetId: 'asset-1', maxBytes: 4 },
    });
    if (readCommand?.type !== 'plugin-trusted.host-command') throw new Error('missing content read');
    handler.handle({
      type: 'plugin-trusted.host-result',
      instanceId,
      requestId: readCommand.requestId,
      ok: true,
      result: {
        assetId: 'asset-1',
        revisionId: 'revision-1',
        byteSize: 8,
        dataBase64: 'AQIDBA==',
        truncated: true,
        mimeType: 'image/png',
      },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => (
      message.type === 'plugin-trusted.host-command' && message.commandId === 'asset.content.replace'
    )); attempt += 1) {
      await flush(10);
    }
    const replaceCommand = posted.find((message) => (
      message.type === 'plugin-trusted.host-command' && message.commandId === 'asset.content.replace'
    ));
    expect(replaceCommand).toMatchObject({
      commandId: 'asset.content.replace',
      input: { assetId: 'asset-1', dataBase64: 'AQID', expectedRevisionId: 'revision-1' },
    });
    if (replaceCommand?.type !== 'plugin-trusted.host-command') throw new Error('missing content replace');
    handler.handle({
      type: 'plugin-trusted.host-result',
      instanceId,
      requestId: replaceCommand.requestId,
      ok: true,
      result: { assetId: 'asset-1', revisionId: 'revision-2', byteSize: 3 },
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
    handler.dispose();
  }, 20_000);
});
