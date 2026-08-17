import { describe, expect, it, vi } from 'vitest';

import {
  PluginContextPublisher,
  PluginPredicateResolverCache,
  createPluginContributionContext,
  createPluginInvocationContext,
  evaluatePluginContextExpression,
} from '../../src/plugins/plugin-context';

function context(revision = 1) {
  return createPluginContributionContext({
    contextId: 'window-1',
    revision,
    app: { platform: 'darwin', locale: 'zh-CN', theme: 'dark', busy: false },
    surface: { id: 'assets', kind: 'asset.contextMenu' },
    window: { windowId: 'window-1' },
    library: { id: 'library-1', open: true, writable: true, offline: false },
    selection: {
      ref: 'selection-1',
      count: 1,
      primaryId: 'asset-1',
      assetCount: 1,
      folderCount: 0,
      mixed: false,
      extensions: ['jpg'],
      mimeTypes: ['image/jpeg'],
      mediaKinds: ['image'],
      summary: {
        managedCount: 1,
        unmanagedCount: 0,
        availableCount: 1,
        unavailableCount: 0,
        deletedCount: 0,
        hasDeleted: false,
        hasUnavailable: false,
      },
      hasDeleted: false,
      hasUnavailable: false,
    },
    browse: { folderId: 'folder-1' },
    viewer: { active: true, assetId: 'asset-1', extension: 'jpg', mimeType: 'image/jpeg', mediaKind: 'image', fullscreen: false },
  });
}

describe('plugin context kernel', () => {
  it('evaluates bounded asset extension and media selection expressions', () => {
    const current = context();
    expect(evaluatePluginContextExpression(
      "selection.assetCount == selection.count && selection.extensions intersects ['jpg','jpeg','png']",
      current,
    )).toBe(true);
    expect(evaluatePluginContextExpression("selection.extensions matches '*.jpg'", current)).toBe(true);
    expect(evaluatePluginContextExpression("selection.extensions intersects ['png']", current)).toBe(false);
  });

  it('handles single, multi and mixed selections without host-side assumptions', () => {
    const multi = createPluginContributionContext({
      ...context(),
      revision: 2,
      selection: {
        ...context().selection,
        count: 2,
        assetCount: 1,
        folderCount: 1,
        mixed: true,
        extensions: ['jpg', 'png'],
      },
    });
    expect(evaluatePluginContextExpression('selection.count == 2 && selection.mixed == true', multi)).toBe(true);
    expect(evaluatePluginContextExpression('selection.assetCount == 1 && selection.folderCount == 1', multi)).toBe(true);
  });

  it('fails closed for malformed expressions and unknown keys', () => {
    const current = context();
    expect(evaluatePluginContextExpression('selection.doesNotExist == true', current)).toBe(false);
    expect(evaluatePluginContextExpression('(selection.count == 1', current)).toBe(false);
    expect(evaluatePluginContextExpression('selection.count == 1 || unknown.key', current)).toBe(false);
  });

  it('publishes monotonically increasing, immutable snapshots', () => {
    const publisher = new PluginContextPublisher();
    const first = publisher.publish(context());
    const second = publisher.publish(context(2));
    expect(second.revision).toBe(2);
    expect(Object.isFrozen(second)).toBe(true);
    expect(() => publisher.publish(context(2))).toThrow(/monotonically/);
    expect(() => publisher.publish({ ...context(3), contextId: 'other-window' })).toThrow(/Context ID/);
    expect(first.contextId).toBe('window-1');
  });

  it('freezes invocation targets before asynchronous work can observe a later context', () => {
    const current = context();
    const invocation = createPluginInvocationContext(current);
    expect(invocation).toMatchObject({
      contextId: 'window-1',
      revision: 1,
      libraryId: 'library-1',
      selection: { refs: [], assetIds: [] },
    });
    expect(Object.isFrozen(invocation)).toBe(true);
    expect(Object.isFrozen(invocation.selection)).toBe(true);
    const later = context(2);
    expect(invocation.revision).toBe(1);
    expect(later.revision).toBe(2);
  });

  it('cancels a pending resolver when a newer revision is started', async () => {
    const cache = new PluginPredicateResolverCache({ defaultDeadlineMs: 100 });
    const signals: AbortSignal[] = [];
    let release: (() => void) | undefined;
    const resolver = vi.fn((_current, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<boolean>((resolve) => { release = () => resolve(true); });
    });
    const first = context(1);
    const second = context(2);
    cache.start({ pluginInstanceId: 'plugin-1', predicateId: 'can-run', context: first, resolver });
    cache.start({ pluginInstanceId: 'plugin-1', predicateId: 'can-run', context: second, resolver });
    await Promise.resolve();
    expect(signals[0]?.aborted).toBe(true);
    release?.();
    await cache.resolve({ pluginInstanceId: 'plugin-1', predicateId: 'can-run', context: second, resolver });
    expect(cache.read({ pluginInstanceId: 'plugin-1', predicateId: 'can-run', context: first })).toBeUndefined();
    expect(cache.read({ pluginInstanceId: 'plugin-1', predicateId: 'can-run', context: second })).toBe(true);
  });

  it('settles a stale resolve with its fallback after a newer revision supersedes it', async () => {
    const cache = new PluginPredicateResolverCache({ defaultDeadlineMs: 100 });
    const resolver = vi.fn(() => new Promise<boolean>(() => {}));
    const first = context(1);
    const second = context(2);
    const stale = cache.resolve({
      pluginInstanceId: 'plugin-1',
      predicateId: 'can-run',
      context: first,
      resolver,
      fallback: false,
    });
    await Promise.resolve();
    cache.start({
      pluginInstanceId: 'plugin-1',
      predicateId: 'can-run',
      context: second,
      resolver: async () => true,
    });
    await expect(stale).resolves.toBe(false);
  });

  it('uses fallback for resolver errors and deadlines while reads remain synchronous', async () => {
    const cache = new PluginPredicateResolverCache({ defaultDeadlineMs: 5 });
    const current = context();
    const key = { pluginInstanceId: 'plugin-1', predicateId: 'can-run', context: current };
    cache.start({ ...key, resolver: async () => { throw new Error('broken'); }, fallback: true });
    expect(cache.read(key)).toBeUndefined();
    await vi.waitFor(() => expect(cache.read(key)).toBe(true));

    const delayed = context(2);
    const delayedKey = { pluginInstanceId: 'plugin-1', predicateId: 'slow', context: delayed };
    cache.start({
      ...delayedKey,
      fallback: false,
      resolver: async () => new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 50)),
      deadlineMs: 1,
    });
    await vi.waitFor(() => expect(cache.read(delayedKey)).toBe(false));
  });
});
