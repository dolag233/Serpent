import { describe, expect, it } from 'vitest';

import { createPluginStandardHostHandler } from '../../src/scripting/plugin-standard-host';
import type { PluginRuntimeChildMessage } from '../../src/shared/plugin-runtime-utility-protocol';

async function flush(ms = 0): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

describe('Plugin Standard Host handler', () => {
  it('activates a precompiled entry, brokers a Gateway command, then deactivates', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = '11111111-1111-4111-8111-111111111111';

    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.demo',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      permissions: ['library.read', 'asset.read'],
      entryJavaScript: `
        export async function activate(serpent) {
          const page = await serpent.assets.search({ query: null, limit: 1 });
          console.log(page.total);
        }
        export async function deactivate() {}
      `,
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.host-command'); attempt += 1) {
      await flush(10);
    }
    const hostCommand = posted.find((message) => message.type === 'plugin-runtime.host-command');
    expect(hostCommand).toMatchObject({
      type: 'plugin-runtime.host-command',
      instanceId,
      commandId: 'asset.search',
    });
    if (hostCommand?.type !== 'plugin-runtime.host-command') throw new Error('missing host command');

    handler.handle({
      type: 'plugin-runtime.host-result',
      instanceId,
      requestId: hostCommand.requestId,
      ok: true,
      result: { items: [], total: 0, offset: 0, limit: 1, hasMore: false },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated')).toBe(true);

    handler.handle({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason: 'library-closed',
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.deactivated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => (
      message.type === 'plugin-runtime.deactivated' && message.reason === 'library-closed'
    ))).toBe(true);
    handler.dispose();
  }, 20_000);

  it('delivers domain events through serpent.events.next and attaches cause chains', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = '22222222-2222-4222-8222-222222222222';
    const eventId = '33333333-3333-4333-8333-333333333333';

    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.events',
      version: '1.0.0',
      packageHash: 'b'.repeat(64),
      permissions: ['library.read', 'asset.read', 'storage.write'],
      entryJavaScript: `
        export async function activate(serpent) {
          serpent.events.on('library.changed', async (event) => {
            await serpent.storage.set('last-event', {
              eventId: event.eventId,
              kind: event.kind,
              changeSequence: event.summary.changeSequence,
            });
            await serpent.assets.search({ query: null, limit: 1 });
          });
        }
        export async function deactivate() {}
      `,
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated')).toBe(true);

    handler.handle({
      type: 'plugin-runtime.domain-event',
      instanceId,
      event: {
        eventId,
        kind: 'library.changed',
        libraryId: 'library-1',
        occurredAt: new Date().toISOString(),
        causeChain: [],
        summary: { changeSequence: 9 },
      },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.storage-request'); attempt += 1) {
      await flush(10);
    }
    const storageRequest = posted.find((message) => message.type === 'plugin-runtime.storage-request');
    expect(storageRequest).toMatchObject({
      type: 'plugin-runtime.storage-request',
      operation: 'set',
      key: 'last-event',
    });
    if (storageRequest?.type !== 'plugin-runtime.storage-request') throw new Error('missing storage');
    handler.handle({
      type: 'plugin-runtime.storage-result',
      instanceId,
      requestId: storageRequest.requestId,
      ok: true,
      result: undefined,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => (
      message.type === 'plugin-runtime.host-command' && message.commandId === 'asset.search'
    )); attempt += 1) {
      await flush(10);
    }
    const hostCommand = posted.find((message) => (
      message.type === 'plugin-runtime.host-command' && message.commandId === 'asset.search'
    ));
    expect(hostCommand).toMatchObject({
      type: 'plugin-runtime.host-command',
      causeChain: [eventId],
    });
    if (hostCommand?.type !== 'plugin-runtime.host-command') throw new Error('missing host command');
    handler.handle({
      type: 'plugin-runtime.host-result',
      instanceId,
      requestId: hostCommand.requestId,
      ok: true,
      result: { items: [], total: 0, offset: 0, limit: 1, hasMore: false },
    });

    handler.handle({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.deactivated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.deactivated')).toBe(true);
    handler.dispose();
  }, 20_000);
});
