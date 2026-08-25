import { describe, expect, it, vi } from 'vitest';

import { PluginProviderScheduler } from '../../src/main/plugin-provider-scheduler';
import type { PluginProviderRegistration } from '../../src/plugins/plugin-providers';

describe('PluginProviderScheduler', () => {
  it('does not enumerate the library when no media provider is active', async () => {
    const listActiveProviders = vi.fn(() => []);
    const requestWorker = vi.fn(async () => ({
      ok: true,
      type: 'asset.list',
      assets: [],
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: { listActiveProviders } as never,
      supervisor: {} as never,
      requestWorker: requestWorker as never,
    });

    await expect(scheduler.resolveMediaProvider({
      libraryId: 'library-1',
      assetId: 'asset-image',
      kind: 'preview',
    })).resolves.toEqual({
      status: 'native-fallback',
      assetId: 'asset-image',
      kind: 'preview',
    });
    expect(listActiveProviders).toHaveBeenCalledTimes(1);
    expect(requestWorker).not.toHaveBeenCalled();
  });

  it('invokes a derived provider in bounded batches and materializes results', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      pluginId: 'com.serpent.derived-field-probe',
      packageHash: 'a'.repeat(64),
      providerId: 'ext-upper',
      kind: 'derived-field',
      fieldId: 'extUpper',
      fieldType: 'string',
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async ({ invoke }: { invoke: { invokeId: string; batch: Array<{ assetId: string; extension: string }> } }) => ({
      result: {
        invokeId: invoke.invokeId,
        status: 'succeeded' as const,
        values: invoke.batch.map((asset) => ({ assetId: asset.assetId, value: asset.extension.toUpperCase() })),
      },
      timedOut: false,
    }));
    const materialized: Array<{ assetId: string; value: string | number | boolean | null }> = [];
    const requestWorker = vi.fn(async (command: { type: string; values?: typeof materialized }) => {
      if (command.type === 'asset.list') {
        return {
          ok: true,
          type: 'asset.list',
          assets: [
            { assetId: 'asset-1', displayName: 'One.png', relativeFilePath: 'One.png', currentRevisionId: 'r1' },
            { assetId: 'asset-2', displayName: 'Two.jpg', relativeFilePath: 'Two.jpg', currentRevisionId: 'r2' },
            { assetId: 'asset-3', displayName: 'Three.gif', relativeFilePath: 'Three.gif', currentRevisionId: 'r3' },
          ] as never,
        };
      }
      materialized.push(...(command.values ?? []));
      return { ok: true, type: 'plugin.derived-fields.materialized', writtenCount: command.values?.length ?? 0 };
    });
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
      batchSize: 2,
    });

    await expect(scheduler.materializeLibrary('library-1')).resolves.toEqual({
      providers: 1,
      batches: 2,
      writtenCount: 3,
      degradedCount: 0,
    });
    expect(invokeProvider).toHaveBeenCalledTimes(2);
    expect(materialized).toEqual([
      { assetId: 'asset-1', value: 'PNG' },
      { assetId: 'asset-2', value: 'JPG' },
      { assetId: 'asset-3', value: 'GIF' },
    ]);
  });

  it('degrades a timed-out search provider without dropping native results', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '22222222-2222-4222-8222-222222222222',
      libraryId: 'library-1',
      pluginId: 'com.serpent.search-probe',
      packageHash: 'b'.repeat(64),
      providerId: 'fixed-token',
      kind: 'search',
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeSearch = vi.fn(async () => ({
      complete: {
        invokeId: '33333333-3333-4333-8333-333333333333',
        status: 'cancelled' as const,
        errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
      },
      timedOut: true,
    }));
    const requestWorker = vi.fn(async (command: { type: string }) => {
      if (command.type === 'asset.search') {
        return {
          ok: true,
          type: 'asset.search.result',
          items: [{ assetId: 'native-1', displayName: 'Native 1' }],
          total: 1,
          offset: 0,
        };
      }
      return {
        ok: true,
        type: 'asset.list',
        assets: [{ assetId: 'provider-1', displayName: 'Provider 1' }],
      };
    });
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeSearch } as never,
      requestWorker: requestWorker as never,
      searchTimeoutMs: 50,
    });

    await expect(scheduler.searchAssets({
      libraryId: 'library-1',
      query: null,
      limit: 10,
    })).resolves.toMatchObject({
      items: [{ assetId: 'native-1' }],
      total: 1,
      degradedProviders: ['fixed-token'],
    });
    expect(invokeSearch).toHaveBeenCalledTimes(1);
  });

  it('passes cancellation through to every in-flight search provider', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '44444444-4444-4444-8444-444444444444',
      libraryId: 'library-1',
      pluginId: 'com.serpent.search-probe',
      packageHash: 'c'.repeat(64),
      providerId: 'fixed-token',
      kind: 'search',
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const controller = new AbortController();
    const invokeSearch = vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBe(controller.signal);
      return {
        complete: {
          invokeId: '55555555-5555-4555-8555-555555555555',
          status: 'cancelled' as const,
          errorCode: 'PLUGIN_PROVIDER_CANCELLED',
        },
        timedOut: false,
      };
    });
    const requestWorker = vi.fn(async (command: { type: string }) => command.type === 'asset.search'
      ? {
        ok: true,
        type: 'asset.search.result',
        items: [{ assetId: 'native-1', displayName: 'Native 1' }],
        total: 1,
        offset: 0,
      }
      : { ok: true, type: 'asset.list', assets: [] });
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeSearch } as never,
      requestWorker: requestWorker as never,
    });

    controller.abort();
    await expect(scheduler.searchAssets({
      libraryId: 'library-1',
      query: null,
      signal: controller.signal,
      limit: 10,
    })).resolves.toMatchObject({ items: [{ assetId: 'native-1' }] });
    expect(invokeSearch).toHaveBeenCalledTimes(1);
  });

  it('invokes a declared thumbnail provider and returns bounded media bytes', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '66666666-6666-4666-8666-666666666666',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: 'd'.repeat(64),
      providerId: 'probe-thumbnail',
      kind: 'thumbnail',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const bytesBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const invokeProvider = vi.fn(async ({ invoke }: { invoke: { invokeId: string } }) => ({
      result: {
        invokeId: invoke.invokeId,
        status: 'succeeded' as const,
        values: [{
          assetId: 'asset-probe',
          media: { mimeType: 'image/png', bytesBase64 },
        }],
      },
      timedOut: false,
    }));
    const requestWorker = vi.fn(async (command: { type: string }) => command.type === 'asset.list'
      ? {
        ok: true,
        type: 'asset.list',
        assets: [{
          assetId: 'asset-probe',
          displayName: 'sample.probe',
          relativeFilePath: 'sample.probe',
          currentRevisionId: 'revision-1',
        }] as never,
      }
      : { ok: false });
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
    });

    await expect(scheduler.resolveMediaProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
      kind: 'thumbnail',
    })).resolves.toEqual({
      status: 'provided',
      assetId: 'asset-probe',
      kind: 'thumbnail',
      providerId: 'probe-thumbnail',
      media: { mimeType: 'image/png', bytesBase64 },
    });
    expect(invokeProvider).toHaveBeenCalledTimes(1);
  });

  it('falls back to native media handling when a matching provider times out', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '77777777-7777-4777-8777-777777777777',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: 'e'.repeat(64),
      providerId: 'probe-preview',
      kind: 'preview',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async () => ({
      result: {
        invokeId: '88888888-8888-4888-8888-888888888888',
        status: 'cancelled' as const,
        values: [],
        errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
      },
      timedOut: true,
    }));
    const requestWorker = vi.fn(async () => ({
      ok: true,
      type: 'asset.list',
      assets: [{
        assetId: 'asset-probe',
        displayName: 'sample.probe',
        relativeFilePath: 'sample.probe',
      }] as never,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
      timeoutMs: 25,
    });

    await expect(scheduler.resolveMediaProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
      kind: 'preview',
    })).resolves.toEqual({
      status: 'native-fallback',
      assetId: 'asset-probe',
      kind: 'preview',
      providerId: 'probe-preview',
      errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
    });
  });

  it('invokes a declared metadata provider and returns bounded JSON metadata', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '88888888-8888-4888-8888-888888888888',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: 'f'.repeat(64),
      providerId: 'probe-metadata',
      kind: 'metadata',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async ({ invoke }: { invoke: { invokeId: string } }) => ({
      result: {
        invokeId: invoke.invokeId,
        status: 'succeeded' as const,
        values: [{
          assetId: 'asset-probe',
          metadata: {
            probeKind: 'metadata-extractor',
            extensionUpper: 'PROBE',
            assetName: 'sample.probe',
          },
        }],
      },
      timedOut: false,
    }));
    const requestWorker = vi.fn(async (command: { type: string }) => command.type === 'asset.list'
      ? {
        ok: true,
        type: 'asset.list',
        assets: [{
          assetId: 'asset-probe',
          displayName: 'sample.probe',
          relativeFilePath: 'sample.probe',
          currentRevisionId: 'revision-1',
        }] as never,
      }
      : { ok: false });
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
    });

    await expect(scheduler.resolveMetadataProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
    })).resolves.toEqual({
      status: 'provided',
      assetId: 'asset-probe',
      providerId: 'probe-metadata',
      metadata: {
        probeKind: 'metadata-extractor',
        extensionUpper: 'PROBE',
        assetName: 'sample.probe',
      },
    });
    expect(invokeProvider).toHaveBeenCalledTimes(1);
  });

  it('falls back to native metadata handling when a matching provider times out', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: '99999999-9999-4999-8999-999999999999',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: '0'.repeat(64),
      providerId: 'probe-metadata',
      kind: 'metadata',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async () => ({
      result: {
        invokeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'cancelled' as const,
        values: [],
        errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
      },
      timedOut: true,
    }));
    const requestWorker = vi.fn(async () => ({
      ok: true,
      type: 'asset.list',
      assets: [{
        assetId: 'asset-probe',
        displayName: 'sample.probe',
        relativeFilePath: 'sample.probe',
      }] as never,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
      timeoutMs: 25,
    });

    await expect(scheduler.resolveMetadataProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
    })).resolves.toEqual({
      status: 'native-fallback',
      assetId: 'asset-probe',
      providerId: 'probe-metadata',
      errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
    });
  });

  it('invokes a declared import provider and returns a bounded import plan stub', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: '1'.repeat(64),
      providerId: 'probe-import',
      kind: 'import',
      extensions: ['probe'],
      mimeTypes: ['application/x-serpent-probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async ({ invoke }: { invoke: { invokeId: string; batch: Array<{ assetId: string }> } }) => ({
      result: {
        invokeId: invoke.invokeId,
        status: 'succeeded' as const,
        values: [{
          assetId: invoke.batch[0]!.assetId,
          importPlan: {
            accepted: true,
            note: 'probe-import-accepted',
            asset: { displayName: 'sample.probe', extension: 'probe' },
          },
        }],
      },
      timedOut: false,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: vi.fn() as never,
    });

    await expect(scheduler.resolveImportProvider({
      libraryId: 'library-1',
      fileName: 'sample.probe',
      mimeType: 'application/x-serpent-probe',
    })).resolves.toEqual({
      status: 'provided',
      providerId: 'probe-import',
      importPlan: {
        accepted: true,
        note: 'probe-import-accepted',
        asset: { displayName: 'sample.probe', extension: 'probe' },
      },
    });
    expect(invokeProvider).toHaveBeenCalledTimes(1);
  });

  it('falls back to native import handling when an import provider times out', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: '2'.repeat(64),
      providerId: 'probe-import',
      kind: 'import',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async () => ({
      result: {
        invokeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'cancelled' as const,
        values: [],
        errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
      },
      timedOut: true,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: vi.fn() as never,
      timeoutMs: 25,
    });

    await expect(scheduler.resolveImportProvider({
      libraryId: 'library-1',
      fileName: 'sample.probe',
    })).resolves.toEqual({
      status: 'native-fallback',
      providerId: 'probe-import',
      errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
    });
  });

  it('invokes a declared export provider and returns a bounded export descriptor', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: '3'.repeat(64),
      providerId: 'probe-export',
      kind: 'export',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const bytesBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const invokeProvider = vi.fn(async ({ invoke }: { invoke: { invokeId: string } }) => ({
      result: {
        invokeId: invoke.invokeId,
        status: 'succeeded' as const,
        values: [{
          assetId: 'asset-probe',
          exportDescriptor: {
            fileName: 'sample.probe.export',
            mimeType: 'application/octet-stream',
            bytesBase64,
            note: 'probe-export-stub',
          },
        }],
      },
      timedOut: false,
    }));
    const requestWorker = vi.fn(async () => ({
      ok: true,
      type: 'asset.list',
      assets: [{
        assetId: 'asset-probe',
        displayName: 'sample.probe',
        relativeFilePath: 'sample.probe',
      }] as never,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
    });

    await expect(scheduler.resolveExportProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
    })).resolves.toEqual({
      status: 'provided',
      assetId: 'asset-probe',
      providerId: 'probe-export',
      exportDescriptor: {
        fileName: 'sample.probe.export',
        mimeType: 'application/octet-stream',
        bytesBase64,
        note: 'probe-export-stub',
      },
    });
  });

  it('invokes a declared AI provider and returns a bounded analysis stub', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: '4'.repeat(64),
      providerId: 'probe-ai',
      kind: 'ai',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async ({ invoke }: { invoke: { invokeId: string } }) => ({
      result: {
        invokeId: invoke.invokeId,
        status: 'succeeded' as const,
        values: [{
          assetId: 'asset-probe',
          analysis: {
            description: 'Probe analysis for sample.probe',
            tags: ['probe', 'fixture', 'probe'],
            rating: 4,
          },
        }],
      },
      timedOut: false,
    }));
    const requestWorker = vi.fn(async () => ({
      ok: true,
      type: 'asset.list',
      assets: [{
        assetId: 'asset-probe',
        displayName: 'sample.probe',
        relativeFilePath: 'sample.probe',
      }] as never,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
    });

    await expect(scheduler.resolveAiProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
    })).resolves.toEqual({
      status: 'provided',
      assetId: 'asset-probe',
      providerId: 'probe-ai',
      analysis: {
        description: 'Probe analysis for sample.probe',
        tags: ['probe', 'fixture', 'probe'],
        rating: 4,
      },
    });
  });

  it('falls back to native AI handling when a matching provider times out', async () => {
    const registration: PluginProviderRegistration = {
      pluginInstanceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      libraryId: 'library-1',
      pluginId: 'com.serpent.preview-thumbnail-probe',
      packageHash: '5'.repeat(64),
      providerId: 'probe-ai',
      kind: 'ai',
      extensions: ['probe'],
    };
    const coordinator = {
      listActiveProviders: vi.fn(() => [registration]),
      findActiveInstance: vi.fn(() => ({ instanceId: registration.pluginInstanceId, mode: 'restricted' })),
    };
    const invokeProvider = vi.fn(async () => ({
      result: {
        invokeId: '10101010-1010-4101-8101-101010101010',
        status: 'cancelled' as const,
        values: [],
        errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
      },
      timedOut: true,
    }));
    const requestWorker = vi.fn(async () => ({
      ok: true,
      type: 'asset.list',
      assets: [{
        assetId: 'asset-probe',
        displayName: 'sample.probe',
        relativeFilePath: 'sample.probe',
      }] as never,
    }));
    const scheduler = new PluginProviderScheduler({
      coordinator: coordinator as never,
      supervisor: { invokeProvider } as never,
      requestWorker: requestWorker as never,
      timeoutMs: 25,
    });

    await expect(scheduler.resolveAiProvider({
      libraryId: 'library-1',
      assetId: 'asset-probe',
    })).resolves.toEqual({
      status: 'native-fallback',
      assetId: 'asset-probe',
      providerId: 'probe-ai',
      errorCode: 'PLUGIN_PROVIDER_TIMEOUT',
    });
  });
});
