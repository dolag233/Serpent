import { describe, expect, it } from 'vitest';

import { automationCapabilitiesFromPluginPermissions } from '../../src/plugins/plugin-permission-capabilities';
import {
  parsePluginRuntimeChildMessage,
  pluginRuntimeChildMessageSchema,
  pluginRuntimeParentMessageSchema,
} from '../../src/shared/plugin-runtime-utility-protocol';
import {
  pluginTrustedChildMessageSchema,
  pluginTrustedParentMessageSchema,
} from '../../src/shared/plugin-trusted-runtime-protocol';

describe('plugin permission → automation capability mapping', () => {
  it('keeps overlapping Gateway capabilities and drops plugin-only permissions', () => {
    expect(automationCapabilitiesFromPluginPermissions([
      'library.read',
      'history.write',
      'asset.read',
      'content.write',
      'tag.write',
      'folder.write',
      'net.fetch',
      'ui.workspace',
    ])).toEqual([
      'asset.read',
      'content.write',
      'folder.write',
      'history.write',
      'library.read',
      'tag.write',
    ]);
  });
});

describe('plugin-runtime utility protocol', () => {
  it('accepts activate/deactivate/host-result envelopes', () => {
    const activate = pluginRuntimeParentMessageSchema.parse({
      type: 'plugin-runtime.activate',
      instanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      pluginId: 'com.example.demo',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      entryJavaScript: 'async function setup() {}',
      permissions: ['library.read', 'asset.read'],
    });
    expect(activate.type).toBe('plugin-runtime.activate');
    if (activate.type === 'plugin-runtime.activate') {
      expect(activate.activateDeadlineMs).toBe(10_000);
    }

    expect(pluginRuntimeParentMessageSchema.parse({
      type: 'plugin-runtime.deactivate',
      instanceId: '11111111-1111-4111-8111-111111111111',
      reason: 'library-closed',
    }).type).toBe('plugin-runtime.deactivate');

    expect(pluginRuntimeChildMessageSchema.parse({
      type: 'plugin-runtime.ready',
    }).type).toBe('plugin-runtime.ready');

    expect(pluginRuntimeChildMessageSchema.parse({
      type: 'plugin-runtime.host-command',
      instanceId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: 'asset.search',
      input: {},
      targetLibraryId: 'library-2',
    })).toMatchObject({ targetLibraryId: 'library-2' });

    expect(pluginRuntimeChildMessageSchema.safeParse({
      type: 'plugin-runtime.host-command',
      instanceId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      commandId: 'asset.search',
      input: {},
      targetLibraryId: '__serpent_global_runtime__',
    }).success).toBe(false);
  });

  it('rejects oversized entry payloads and missing host-result errors', () => {
    expect(pluginRuntimeParentMessageSchema.safeParse({
      type: 'plugin-runtime.activate',
      instanceId: '11111111-1111-4111-8111-111111111111',
      libraryId: 'library-1',
      pluginId: 'com.example.demo',
      version: '1.0.0',
      packageHash: 'a'.repeat(64),
      entryJavaScript: 'x'.repeat(512 * 1024 + 1),
      permissions: [],
    }).success).toBe(false);

    expect(pluginRuntimeParentMessageSchema.safeParse({
      type: 'plugin-runtime.host-result',
      instanceId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
      ok: false,
    }).success).toBe(false);
  });

  it('requires an input-capture session id on both runtime transports', () => {
    const common = {
      instanceId: '11111111-1111-4111-8111-111111111111',
      requestId: '22222222-2222-4222-8222-222222222222',
    };
    expect(pluginRuntimeParentMessageSchema.safeParse({
      type: 'plugin-runtime.input-capture.started',
      ...common,
    }).success).toBe(false);
    expect(pluginTrustedParentMessageSchema.safeParse({
      type: 'plugin-trusted.input-capture.started',
      ...common,
    }).success).toBe(false);
  });

  it('bounds and validates job progress messages', () => {
    const base = {
      type: 'plugin-runtime.job-progress',
      instanceId: '11111111-1111-4111-8111-111111111111',
      jobId: '22222222-2222-4222-8222-222222222222',
    } as const;
    expect(pluginRuntimeChildMessageSchema.safeParse({
      ...base,
      progress: { completed: 2, total: 4, phase: 'read', message: 'Halfway' },
      targetLibraryId: 'library-2',
    }).success).toBe(true);
    expect(pluginRuntimeChildMessageSchema.safeParse({
      ...base,
      progress: { completed: 5, total: 4, phase: 'read', message: '' },
    }).success).toBe(false);
    expect(pluginRuntimeChildMessageSchema.safeParse({
      ...base,
      progress: { completed: 1, total: 2, phase: 'x'.repeat(129), message: '' },
    }).success).toBe(false);
    expect(pluginRuntimeChildMessageSchema.safeParse({
      type: 'plugin-runtime.job-enqueue',
      instanceId: base.instanceId,
      requestId: base.jobId,
      handlerId: 'upscale',
      payload: {},
      targetLibraryId: 'library-2',
    }).success).toBe(true);
    expect(pluginRuntimeChildMessageSchema.safeParse({
      type: 'plugin-runtime.job-enqueue',
      instanceId: base.instanceId,
      requestId: base.jobId,
      handlerId: 'upscale',
      payload: {},
      targetLibraryId: '__serpent_global_runtime__',
    }).success).toBe(false);
    expect(pluginRuntimeChildMessageSchema.safeParse({
      type: 'plugin-runtime.job-control',
      instanceId: base.instanceId,
      requestId: base.jobId,
      jobId: base.jobId,
      action: 'pause',
      checkpoint: {
        version: 'v1', data: {}, savedAt: '2026-08-02T00:00:00.000Z',
      },
    }).success).toBe(true);
    expect(pluginRuntimeParentMessageSchema.safeParse({
      type: 'plugin-runtime.job-signal',
      instanceId: base.instanceId,
      jobId: base.jobId,
      action: 'cancel',
    }).success).toBe(true);
    expect(pluginRuntimeParentMessageSchema.safeParse({
      type: 'plugin-runtime.job-control-result',
      instanceId: base.instanceId,
      requestId: base.jobId,
      ok: false,
      error: { code: 'JOB_OWNERSHIP_MISMATCH', message: 'no' },
    }).success).toBe(true);
    expect(pluginTrustedChildMessageSchema.safeParse({
      type: 'plugin-trusted.job-progress',
      instanceId: base.instanceId,
      jobId: base.jobId,
      progress: { completed: 1, total: 2, phase: 'read', message: '' },
      targetLibraryId: 'library-2',
    }).success).toBe(true);
    expect(pluginTrustedChildMessageSchema.safeParse({
      type: 'plugin-trusted.job-progress',
      instanceId: base.instanceId,
      jobId: base.jobId,
      progress: { completed: 1, total: 2, phase: 'read', message: '' },
      targetLibraryId: '__serpent_global_runtime__',
    }).success).toBe(false);
    expect(pluginTrustedChildMessageSchema.safeParse({
      type: 'plugin-trusted.job-control',
      instanceId: base.instanceId,
      requestId: base.jobId,
      jobId: base.jobId,
      action: 'retry',
    }).success).toBe(true);
  });

  it('retains the complete plugin job contract in both child protocols', () => {
    const full = {
      completed: 4,
      total: 4,
      phase: 'writeback',
      message: 'done',
      progress: 1,
      itemResults: [{ itemId: 'asset-1', status: 'succeeded' }],
      failedAssetIds: [],
      retryInput: { attempt: 2 },
      checkpoint: {
        version: 'v1',
        data: { cursor: 'end' },
        savedAt: '2026-08-02T00:00:00.000Z',
      },
    };
    expect(pluginRuntimeChildMessageSchema.parse({
      type: 'plugin-runtime.job-complete',
      instanceId: '11111111-1111-4111-8111-111111111111',
      jobId: '22222222-2222-4222-8222-222222222222',
      status: 'succeeded',
      ...full,
    })).toMatchObject(full);
    expect(pluginTrustedChildMessageSchema.parse({
      type: 'plugin-trusted.job-complete',
      instanceId: '11111111-1111-4111-8111-111111111111',
      jobId: '22222222-2222-4222-8222-222222222222',
      status: 'succeeded',
      ...full,
    })).toMatchObject(full);
  });

  it('classifies extensible events separately from control-plane faults', () => {
    expect(parsePluginRuntimeChildMessage({
      type: 'plugin-runtime.event',
      instanceId: '11111111-1111-4111-8111-111111111111',
      eventType: 'future.progress',
      critical: false,
      payload: { completed: 1 },
    })).toEqual({
      kind: 'ignored-event',
      eventType: 'future.progress',
      instanceId: '11111111-1111-4111-8111-111111111111',
    });

    expect(parsePluginRuntimeChildMessage({
      type: 'plugin-runtime.event',
      instanceId: '11111111-1111-4111-8111-111111111111',
      eventType: 'future.policy',
      critical: true,
      payload: null,
    })).toEqual(expect.objectContaining({ kind: 'fault' }));

    expect(parsePluginRuntimeChildMessage({
      type: 'plugin-runtime.control.future',
      instanceId: '11111111-1111-4111-8111-111111111111',
    })).toEqual(expect.objectContaining({ kind: 'fault' }));
  });
});
