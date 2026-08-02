import { describe, expect, it } from 'vitest';

import {
  PluginHookBlockedError,
  aggregatePluginHookDecisions,
  createPluginHookInvokeQueue,
  normalizePluginHookDecision,
} from '../../src/plugins/plugin-hooks';

describe('plugin hooks', () => {
  it('normalizes invalid decisions to allow', () => {
    expect(normalizePluginHookDecision(null)).toEqual({ action: 'allow' });
    expect(normalizePluginHookDecision({ action: 'block' })).toEqual({ action: 'allow' });
    expect(normalizePluginHookDecision({
      action: 'block',
      code: 'DEMO',
      message: 'blocked',
    })).toEqual({ action: 'block', code: 'DEMO', message: 'blocked' });
  });

  it('aggregates warnings and authorized blocks in pluginId order', () => {
    const result = aggregatePluginHookDecisions([
      {
        pluginId: 'com.b.warn',
        blockingDeclared: false,
        hasBlockingPermission: false,
        decision: { action: 'warn', message: 'check tags' },
        timedOut: false,
      },
      {
        pluginId: 'com.a.block',
        blockingDeclared: true,
        hasBlockingPermission: true,
        decision: { action: 'block', code: 'NO_TRASH', message: 'policy' },
        timedOut: false,
      },
    ]);
    expect(result).toEqual({
      outcome: 'block',
      warnings: [],
      block: { pluginId: 'com.a.block', code: 'NO_TRASH', message: 'policy' },
    });
  });

  it('ignores block without permission or declaration and fails open on timeout', () => {
    const result = aggregatePluginHookDecisions([
      {
        pluginId: 'com.example.unauthorized',
        blockingDeclared: true,
        hasBlockingPermission: false,
        decision: { action: 'block', code: 'X', message: 'no' },
        timedOut: false,
      },
      {
        pluginId: 'com.example.slow',
        blockingDeclared: true,
        hasBlockingPermission: true,
        decision: { action: 'block', code: 'Y', message: 'late' },
        timedOut: true,
      },
      {
        pluginId: 'com.example.warn',
        blockingDeclared: false,
        hasBlockingPermission: false,
        decision: { action: 'warn', message: 'note' },
        timedOut: false,
      },
    ]);
    expect(result).toEqual({
      outcome: 'allow',
      warnings: ['[com.example.warn] note'],
    });
  });

  it('creates PluginHookBlockedError with stable public code', () => {
    const error = new PluginHookBlockedError({
      pluginId: 'com.example',
      hookCode: 'DEMO_BLOCK',
      message: 'blocked by policy',
    });
    expect(error.publicCode).toBe('PLUGIN_HOOK_BLOCKED');
    expect(error.pluginId).toBe('com.example');
    expect(error.hookCode).toBe('DEMO_BLOCK');
  });

  it('delivers hook invokes through a bounded queue', async () => {
    const queue = createPluginHookInvokeQueue({ maxBuffered: 1 });
    const waiting = queue.next();
    queue.push({
      invokeId: '11111111-1111-4111-8111-111111111111',
      event: 'asset.trash',
      context: {
        event: 'asset.trash',
        libraryId: 'library-1',
        summary: { assetIds: ['a1'] },
        causeChain: [],
      },
    });
    await expect(waiting).resolves.toMatchObject({ event: 'asset.trash' });
    const closing = queue.next();
    queue.close();
    await expect(closing).resolves.toBeNull();
  });
});
