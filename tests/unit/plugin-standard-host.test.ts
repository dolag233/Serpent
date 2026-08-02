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
        export async function setup(serpent) {
          const page = await serpent.assets.search({ query: null, limit: 1 });
          console.log(page.total);
        }
        export async function dispose(reason) {
          console.log(`disposed:${reason}`);
        }
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
    expect(posted.some((message) => (
      message.type === 'plugin-runtime.console' && message.message === 'disposed:library-closed'
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
        export async function setup(serpent) {
          serpent.events.on('library.changed', async (event) => {
            await serpent.storage.set('last-event', {
              eventId: event.eventId,
              kind: event.kind,
              changeSequence: event.summary.changeSequence,
            });
            await serpent.assets.search({ query: null, limit: 1 });
          });
        }
        export async function dispose() {}
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

  it('invokes onWill hooks and posts hook-decision responses', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = '44444444-4444-4444-8444-444444444444';
    const invokeId = '55555555-5555-4555-8555-555555555555';

    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.hooks',
      version: '1.0.0',
      packageHash: 'c'.repeat(64),
      permissions: ['library.read', 'asset.read', 'hook.blocking'],
      entryJavaScript: `
        export async function setup(serpent) {
          serpent.hooks.onWill('asset.trash', async () => ({
            action: 'block',
            code: 'DEMO_BLOCK',
            message: 'refused',
          }));
        }
        export async function dispose() {}
      `,
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated')).toBe(true);

    handler.handle({
      type: 'plugin-runtime.hook-invoke',
      instanceId,
      invoke: {
        invokeId,
        event: 'asset.trash',
        context: {
          event: 'asset.trash',
          libraryId: 'library-1',
          summary: { assetIds: ['asset-1'] },
          causeChain: [],
        },
      },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.hook-decision'); attempt += 1) {
      await flush(10);
    }
    expect(posted).toContainEqual({
      type: 'plugin-runtime.hook-decision',
      instanceId,
      invokeId,
      decision: {
        action: 'block',
        code: 'DEMO_BLOCK',
        message: 'refused',
      },
    });

    handler.handle({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.deactivated'); attempt += 1) {
      await flush(10);
    }
    handler.dispose();
  }, 20_000);

  it('registers a job handler, enqueues during activate, and completes on job-invoke', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = '66666666-6666-4666-8666-666666666666';

    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.jobs',
      version: '1.0.0',
      packageHash: 'd'.repeat(64),
      permissions: ['library.read', 'job.manage', 'storage.write'],
      entryJavaScript: `
        export async function setup(serpent) {
          serpent.jobs.registerHandler('tick', async (payload) => {
            await serpent.storage.set('job-tick', payload);
          });
          await serpent.jobs.enqueue({ handlerId: 'tick', payload: { tick: 1 } });
        }
        export async function dispose() {}
      `,
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.job-enqueue'); attempt += 1) {
      await flush(10);
    }
    const enqueueMessage = posted.find((message) => message.type === 'plugin-runtime.job-enqueue');
    expect(enqueueMessage).toMatchObject({
      type: 'plugin-runtime.job-enqueue',
      instanceId,
      handlerId: 'tick',
      payload: { tick: 1 },
    });
    if (enqueueMessage?.type !== 'plugin-runtime.job-enqueue') throw new Error('missing job enqueue');

    handler.handle({
      type: 'plugin-runtime.job-enqueue-result',
      instanceId,
      requestId: enqueueMessage.requestId,
      ok: true,
      result: { jobId: '77777777-7777-4777-8777-777777777777' },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated')).toBe(true);

    handler.handle({
      type: 'plugin-runtime.job-invoke',
      instanceId,
      job: {
        jobId: '77777777-7777-4777-8777-777777777777',
        libraryId: 'library-1',
        kind: 'plugin.background',
        status: 'running',
        progress: 0,
        attemptCount: 1,
        errorCode: null,
        errorDetail: null,
        ownerPluginId: 'com.example.jobs',
        ownerPackageHash: 'd'.repeat(64),
        pluginHandlerId: 'tick',
        payload: { tick: 1 },
        recoveryStrategy: 'idempotent',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.storage-request'); attempt += 1) {
      await flush(10);
    }
    const storageRequest = posted.find((message) => message.type === 'plugin-runtime.storage-request');
    expect(storageRequest).toMatchObject({
      type: 'plugin-runtime.storage-request',
      operation: 'set',
      key: 'job-tick',
    });
    if (storageRequest?.type !== 'plugin-runtime.storage-request') throw new Error('missing storage');
    handler.handle({
      type: 'plugin-runtime.storage-result',
      instanceId,
      requestId: storageRequest.requestId,
      ok: true,
      result: undefined,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.job-complete'); attempt += 1) {
      await flush(10);
    }
    expect(posted).toContainEqual({
      type: 'plugin-runtime.job-complete',
      instanceId,
      jobId: '77777777-7777-4777-8777-777777777777',
      status: 'succeeded',
    });

    handler.handle({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.deactivated'); attempt += 1) {
      await flush(10);
    }
    handler.dispose();
  }, 20_000);

  it('registers and invokes a derived-field provider in a bounded batch', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = 'abababab-abab-4aba-8aba-abababababab';
    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.providers',
      version: '1.0.0',
      packageHash: 'f'.repeat(64),
      permissions: ['asset.read', 'derived-field.provider'],
      entryJavaScript: `
        export async function setup(serpent) {
          serpent.providers.register('derived-field', {
            id: 'ext-upper',
            compute: async (batch) => batch.map((asset) => ({
              assetId: asset.assetId,
              value: asset.extension.toUpperCase(),
            })),
          });
        }
        export async function dispose() {}
      `,
      activateDeadlineMs: 15_000,
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated')).toBe(true);

    handler.handle({
      type: 'plugin-runtime.provider-invoke',
      instanceId,
      invoke: {
        invokeId: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',
        providerId: 'ext-upper',
        kind: 'derived-field',
        fieldId: 'extUpper',
        fieldType: 'string',
        batch: [{
          assetId: 'asset-1',
          name: 'Brick.PNG',
          extension: 'png',
          relativeFilePath: 'Brick.PNG',
        }],
        deadlineAt: Date.now() + 5_000,
        maxResults: 1,
      },
    });

    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.provider-complete'); attempt += 1) {
      await flush(10);
    }
    expect(posted).toContainEqual({
      type: 'plugin-runtime.provider-complete',
      instanceId,
      invokeId: 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',
      status: 'succeeded',
      values: [{ assetId: 'asset-1', value: 'PNG' }],
    });

    handler.handle({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    handler.dispose();
  }, 20_000);

  it('registers a search provider and streams bounded result chunks', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => posted.push(message),
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = 'bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc';
    const invokeId = 'cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd';
    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.search',
      version: '1.0.0',
      packageHash: '1'.repeat(64),
      permissions: ['search.provider'],
      entryJavaScript: `
        export async function setup(serpent) {
          serpent.providers.registerSearch({
            id: 'fixed-token',
            search: async (request, signal) => {
              if (signal.aborted) return [];
              return [
                { assetId: 'provider-1', sortKey: '0001' },
                { assetId: 'provider-2', sortKey: '0002' },
              ].slice(0, request.maxResults);
            },
          });
        }
        export async function dispose() {}
      `,
      activateDeadlineMs: 15_000,
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated'), JSON.stringify(posted)).toBe(true);

    handler.handle({
      type: 'plugin-runtime.search-request',
      instanceId,
      request: {
        invokeId,
        providerId: 'fixed-token',
        query: null,
        offset: 0,
        limit: 2,
        deadlineAt: Date.now() + 5_000,
        maxResults: 2,
      },
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.search-complete'); attempt += 1) {
      await flush(10);
    }
    expect(posted).toContainEqual({
      type: 'plugin-runtime.search-chunk',
      instanceId,
      invokeId,
      items: [
        { assetId: 'provider-1', sortKey: '0001' },
        { assetId: 'provider-2', sortKey: '0002' },
      ],
    });
    expect(posted).toContainEqual({
      type: 'plugin-runtime.search-complete',
      instanceId,
      invokeId,
      status: 'succeeded',
      nextOffset: 2,
    });
    handler.handle({ type: 'plugin-runtime.deactivate', instanceId, reason: 'library-closed' });
    handler.dispose();
  }, 20_000);

  it('registers a command handler, invokes it with asset context, and completes', async () => {
    const posted: PluginRuntimeChildMessage[] = [];
    const handler = createPluginStandardHostHandler({
      postMessage: (message) => {
        posted.push(message);
      },
      heartbeatIntervalMs: 60_000,
    });
    const instanceId = '88888888-8888-4888-8888-888888888888';
    const invokeId = '99999999-9999-4999-8999-999999999999';

    handler.handle({
      type: 'plugin-runtime.activate',
      instanceId,
      libraryId: 'library-1',
      pluginId: 'com.example.commands',
      version: '1.0.0',
      packageHash: 'e'.repeat(64),
      permissions: ['library.read', 'storage.write'],
      entryJavaScript: `
        export async function setup(serpent) {
          serpent.commands.register('probe.write-selection', async (context) => {
            await serpent.storage.set('menu-command', { assetId: context.assetIds[0] });
          });
        }
        export async function dispose() {}
      `,
      activateDeadlineMs: 15_000,
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.activated'); attempt += 1) {
      await flush(10);
    }
    expect(posted.some((message) => message.type === 'plugin-runtime.activated')).toBe(true);

    handler.handle({
      type: 'plugin-runtime.command-invoke',
      instanceId,
      invoke: {
        invokeId,
        commandId: 'probe.write-selection',
        context: { assetIds: ['asset-1'] },
      },
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.storage-request'); attempt += 1) {
      await flush(10);
    }
    const storageRequest = posted.find((message) => message.type === 'plugin-runtime.storage-request');
    expect(storageRequest).toMatchObject({
      type: 'plugin-runtime.storage-request',
      operation: 'set',
      key: 'menu-command',
      value: { assetId: 'asset-1' },
    });
    if (storageRequest?.type !== 'plugin-runtime.storage-request') throw new Error('missing storage');
    handler.handle({
      type: 'plugin-runtime.storage-result',
      instanceId,
      requestId: storageRequest.requestId,
      ok: true,
      result: undefined,
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.command-complete'); attempt += 1) {
      await flush(10);
    }
    expect(posted).toContainEqual({
      type: 'plugin-runtime.command-complete',
      instanceId,
      invokeId,
      status: 'succeeded',
    });
    handler.handle({
      type: 'plugin-runtime.deactivate',
      instanceId,
      reason: 'library-closed',
    });
    for (let attempt = 0; attempt < 200 && !posted.some((message) => message.type === 'plugin-runtime.deactivated'); attempt += 1) {
      await flush(10);
    }
    handler.dispose();
  }, 20_000);
});
