import { describe, expect, it } from 'vitest';

import {
  createPluginSearchEventQueue,
  mergePluginSearchResults,
  pluginSearchCancelSchema,
  pluginSearchChunkSchema,
  pluginSearchCompleteSchema,
  pluginSearchRequestSchema,
} from '../../src/plugins/plugin-search';

describe('plugin search protocol', () => {
  it('validates bounded paginated requests and progressive messages', () => {
    const request = pluginSearchRequestSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      providerId: 'fixed-token',
      query: null,
      offset: 0,
      limit: 20,
      deadlineAt: Date.now() + 1_000,
      maxResults: 20,
    });
    expect(request.maxResults).toBe(20);
    expect(pluginSearchChunkSchema.parse({
      invokeId: request.invokeId,
      items: [{ assetId: 'asset-provider', sortKey: '0001' }],
    }).items).toHaveLength(1);
    expect(pluginSearchCompleteSchema.parse({
      invokeId: request.invokeId,
      status: 'succeeded',
      nextOffset: 1,
    }).nextOffset).toBe(1);
    expect(pluginSearchCancelSchema.parse({
      invokeId: request.invokeId,
      reason: 'cancelled',
    }).reason).toBe('cancelled');
  });

  it('closes a search event queue and resolves pending readers', async () => {
    const queue = createPluginSearchEventQueue();
    const pending = queue.next();
    queue.close();
    await expect(pending).resolves.toBeNull();
  });
});

describe('mergePluginSearchResults', () => {
  it('keeps native results while adding unique provider assets under the cap', () => {
    const result = mergePluginSearchResults({
      native: {
        items: [
          { assetId: 'native-1', displayName: 'Native 1' },
          { assetId: 'shared', displayName: 'Native shared' },
        ] as never,
        total: 2,
        offset: 0,
      },
      providerChunks: [[
        { assetId: 'shared', sortKey: '0001' },
        { assetId: 'provider-1', sortKey: '0002' },
      ]],
      providerAssets: new Map([
        ['provider-1', { assetId: 'provider-1', displayName: 'Provider 1' }],
      ]) as never,
      limit: 3,
      offset: 0,
    });

    expect(result.items.map((item) => item.assetId)).toEqual(['native-1', 'shared', 'provider-1']);
    expect(result.total).toBe(3);
  });

  it('does not exceed the requested result cap', () => {
    const result = mergePluginSearchResults({
      native: {
        items: [{ assetId: 'native-1', displayName: 'Native 1' }] as never,
        total: 10,
        offset: 0,
      },
      providerChunks: [[
        { assetId: 'provider-1', sortKey: '0001' },
        { assetId: 'provider-2', sortKey: '0002' },
      ]],
      providerAssets: new Map([
        ['provider-1', { assetId: 'provider-1', displayName: 'Provider 1' }],
        ['provider-2', { assetId: 'provider-2', displayName: 'Provider 2' }],
      ]) as never,
      limit: 2,
      offset: 0,
    });

    expect(result.items).toHaveLength(2);
  });
});
