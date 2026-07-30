import { describe, expect, it } from 'vitest';

import { automationCapabilitiesFromPluginPermissions } from '../../src/plugins/plugin-permission-capabilities';
import {
  pluginRuntimeChildMessageSchema,
  pluginRuntimeParentMessageSchema,
} from '../../src/shared/plugin-runtime-utility-protocol';

describe('plugin permission → automation capability mapping', () => {
  it('keeps overlapping Gateway capabilities and drops plugin-only permissions', () => {
    expect(automationCapabilitiesFromPluginPermissions([
      'library.read',
      'asset.read',
      'tag.write',
      'folder.write',
      'net.fetch',
      'ui.workspace',
    ])).toEqual([
      'asset.read',
      'folder.write',
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
      entryJavaScript: 'async function activate() {}',
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
});
