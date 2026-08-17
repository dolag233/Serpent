import { describe, expect, it } from 'vitest';

import {
  createPluginProviderInvokeQueue,
  pluginProviderBatchResultSchema,
  pluginProviderInvokeSchema,
} from '../../src/plugins/plugin-providers';

describe('plugin provider contracts', () => {
  it('accepts a bounded derived-field batch and validates returned values', () => {
    const invoke = pluginProviderInvokeSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      providerId: 'ext-upper',
      kind: 'derived-field',
      fieldId: 'extUpper',
      fieldType: 'string',
      batch: [
        {
          assetId: 'asset-1',
          name: 'Brick.PNG',
          extension: 'png',
          relativeFilePath: 'Brick.PNG',
        },
      ],
      deadlineAt: Date.now() + 5_000,
      maxResults: 1,
    });

    expect(invoke.batch).toHaveLength(1);
    expect(pluginProviderBatchResultSchema.parse({
      invokeId: invoke.invokeId,
      status: 'succeeded',
      values: [{ assetId: 'asset-1', value: 'PNG' }],
    }).values[0]).toEqual({ assetId: 'asset-1', value: 'PNG' });
  });

  it('accepts bounded preview bytes and rejects oversized media payloads', () => {
    const invoke = pluginProviderInvokeSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      providerId: 'probe-preview',
      kind: 'preview',
      batch: [{
        assetId: 'asset-1',
        name: 'sample.probe',
        extension: 'probe',
        relativeFilePath: 'sample.probe',
      }],
      deadlineAt: Date.now() + 5_000,
      maxResults: 1,
    });
    const bytesBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

    expect(pluginProviderBatchResultSchema.parse({
      invokeId: invoke.invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        media: { mimeType: 'image/png', bytesBase64 },
      }],
    }).values[0]).toMatchObject({
      assetId: 'asset-1',
      media: { mimeType: 'image/png', bytesBase64 },
    });
    expect(() => pluginProviderBatchResultSchema.parse({
      invokeId: invoke.invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        media: { mimeType: 'image/png', bytesBase64: 'A'.repeat(400_000) },
      }],
    })).toThrow();
  });

  it('accepts bounded metadata JSON and rejects path-like values', () => {
    const invoke = pluginProviderInvokeSchema.parse({
      invokeId: '33333333-3333-4333-8333-333333333333',
      providerId: 'probe-metadata',
      kind: 'metadata',
      batch: [{
        assetId: 'asset-1',
        name: 'sample.probe',
        extension: 'probe',
        relativeFilePath: 'sample.probe',
      }],
      deadlineAt: Date.now() + 1_000,
      maxResults: 1,
    });
    expect(pluginProviderBatchResultSchema.parse({
      invokeId: invoke.invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        metadata: {
          probeKind: 'metadata-extractor',
          extensionUpper: 'PROBE',
        },
      }],
    }).values[0]).toMatchObject({
      assetId: 'asset-1',
      metadata: { probeKind: 'metadata-extractor', extensionUpper: 'PROBE' },
    });
    expect(() => pluginProviderBatchResultSchema.parse({
      invokeId: invoke.invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        metadata: { filePath: '/tmp/secret.png' },
      }],
    })).toThrow();
    expect(() => pluginProviderBatchResultSchema.parse({
      invokeId: invoke.invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        metadata: { note: '/Users/demo/secret.png' },
      }],
    })).toThrow();
  });

  it('accepts bounded import/export/ai provider results and rejects oversized export bytes', () => {
    const bytesBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const invokeId = '44444444-4444-4444-8444-444444444444';
    expect(pluginProviderBatchResultSchema.parse({
      invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'import-candidate',
        importPlan: { accepted: true, note: 'probe-import-accepted' },
      }],
    }).values[0]).toMatchObject({ importPlan: { accepted: true } });
    expect(pluginProviderBatchResultSchema.parse({
      invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        exportDescriptor: { fileName: 'out.probe', mimeType: 'application/octet-stream', bytesBase64 },
      }],
    }).values[0]).toMatchObject({ exportDescriptor: { fileName: 'out.probe' } });
    expect(pluginProviderBatchResultSchema.parse({
      invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        analysis: { description: 'Probe', tags: ['probe'], rating: 4 },
      }],
    }).values[0]).toMatchObject({ analysis: { tags: ['probe'], rating: 4 } });
    expect(() => pluginProviderBatchResultSchema.parse({
      invokeId,
      status: 'succeeded',
      values: [{
        assetId: 'asset-1',
        exportDescriptor: { bytesBase64: 'A'.repeat(400_000) },
      }],
    })).toThrow();
  });

  it('drops oldest queued batches at the backpressure boundary and closes waiters', async () => {
    const queue = createPluginProviderInvokeQueue({ maxBuffered: 1 });
    const first = pluginProviderInvokeSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      providerId: 'provider',
      kind: 'derived-field',
      fieldId: 'field',
      fieldType: 'string',
      batch: [],
      deadlineAt: Date.now() + 1_000,
      maxResults: 1,
    });
    const second = { ...first, invokeId: '22222222-2222-4222-8222-222222222222' };

    queue.push(first);
    queue.push(second);

    await expect(queue.next()).resolves.toMatchObject({ invokeId: second.invokeId });
    const pending = queue.next();
    queue.close();
    await expect(pending).resolves.toBeNull();
  });
});
