import { describe, expect, it } from 'vitest';

import {
  nextPluginViewState,
  buildPluginIframeViewDescriptors,
  type PluginViewLifecycleState,
} from '../../src/renderer/plugin-iframe-view-host';
import {
  parsePluginUiHostMessage,
  parsePluginUiIframeMessage,
} from '../../src/shared/plugin-ui-protocol';

/* ------------------------------------------------------------------ *
 * Lifecycle state machine
 * ------------------------------------------------------------------ */

describe('plugin view lifecycle state machine', () => {
  const READY: PluginViewLifecycleState = 'ready';

  it('loads, confirms, and stays ready', () => {
    let state: PluginViewLifecycleState = 'loading';
    state = nextPluginViewState(state, { type: 'frame-load' }); // initial load
    expect(state).toBe('loading');
    state = nextPluginViewState(state, { type: 'plugin-ready' });
    expect(state).toBe('ready');
    // Repeated ready messages are harmless.
    expect(nextPluginViewState(state, { type: 'plugin-ready' })).toBe('ready');
    expect(nextPluginViewState(state, { type: 'frame-load' })).toBe('reloading');
  });

  it('distinguishes an initial load from a ready-document reload', () => {
    const initial = nextPluginViewState('loading', { type: 'frame-load' });
    expect(initial).toBe('loading');
    const reload = nextPluginViewState(READY, { type: 'frame-load' });
    expect(reload).toBe('reloading');
    const doubleReload = nextPluginViewState('reloading', { type: 'frame-load' });
    expect(doubleReload).toBe('reloading');
    expect(nextPluginViewState('reloading', { type: 'plugin-ready' })).toBe('ready');
  });

  it('crashes on frame errors and recovers via retry', () => {
    expect(nextPluginViewState('loading', { type: 'frame-error' })).toBe('crashed');
    expect(nextPluginViewState('reloading', { type: 'frame-error' })).toBe('crashed');
    // A retry reloads the frame and re-enters loading.
    expect(nextPluginViewState('crashed', { type: 'frame-load' })).toBe('loading');
    // A ready message after a crash is stale-document noise and is ignored.
    expect(nextPluginViewState('crashed', { type: 'plugin-ready' })).toBe('crashed');
  });

  it('disposes deterministically and ignores later events', () => {
    const disposed = nextPluginViewState(READY, { type: 'dispose' });
    expect(disposed).toBe('disposed');
    expect(nextPluginViewState(disposed, { type: 'plugin-ready' })).toBe('disposed');
    expect(nextPluginViewState(disposed, { type: 'frame-load' })).toBe('disposed');
    expect(nextPluginViewState(disposed, { type: 'frame-error' })).toBe('disposed');
  });
});

/* ------------------------------------------------------------------ *
 * Host→plugin view contract messages
 * ------------------------------------------------------------------ */

describe('plugin view contract host messages', () => {
  it('announces mount with view type, scope, and optional library/state', () => {
    const mounted = parsePluginUiHostMessage({
      type: 'plugin-ui.view-mounted',
      contributionId: 'probe-view',
      instanceId: 'inst-1',
      viewType: 'sidebar',
      scope: 'library',
      libraryId: 'lib-1',
      state: { folderId: 'root' },
    });
    expect(mounted.type).toBe('plugin-ui.view-mounted');
    if (mounted.type !== 'plugin-ui.view-mounted') return;
    expect(mounted.viewType).toBe('sidebar');
    expect(mounted.scope).toBe('library');
    expect(mounted.libraryId).toBe('lib-1');

    // Global views omit the library.
    const globalMounted = parsePluginUiHostMessage({
      type: 'plugin-ui.view-mounted',
      contributionId: 'global-view',
      instanceId: 'inst-2',
      viewType: 'settings-page',
      scope: 'global',
    });
    expect(globalMounted.type).toBe('plugin-ui.view-mounted');
  });

  it('rejects unknown view types or scopes', () => {
    expect(() => parsePluginUiHostMessage({
      type: 'plugin-ui.view-mounted',
      contributionId: 'v',
      instanceId: 'i',
      viewType: 'floating-window',
      scope: 'global',
    })).toThrow();

    expect(() => parsePluginUiHostMessage({
      type: 'plugin-ui.view-mounted',
      contributionId: 'v',
      instanceId: 'i',
      viewType: 'sidebar',
      scope: 'private',
    })).toThrow();
  });

  it('pushes state changes, sizes, and unmount notifications', () => {
    const stateChanged = parsePluginUiHostMessage({
      type: 'plugin-ui.view-state-changed',
      contributionId: 'v',
      instanceId: 'i',
      state: { selection: ['a', 'b'] },
    });
    expect(stateChanged.type).toBe('plugin-ui.view-state-changed');

    const resized = parsePluginUiHostMessage({
      type: 'plugin-ui.view-resized',
      contributionId: 'v',
      instanceId: 'i',
      width: 640,
      height: 480,
    });
    expect(resized.type).toBe('plugin-ui.view-resized');

    const unmounted = parsePluginUiHostMessage({
      type: 'plugin-ui.view-unmounted',
      contributionId: 'v',
      instanceId: 'i',
    });
    expect(unmounted.type).toBe('plugin-ui.view-unmounted');
  });

  it('bounds view state to small JSON payloads', () => {
    const huge = { blob: 'x'.repeat(20 * 1024) };
    expect(() => parsePluginUiHostMessage({
      type: 'plugin-ui.view-mounted',
      contributionId: 'v',
      instanceId: 'i',
      viewType: 'sidebar',
      scope: 'global',
      state: huge,
    })).toThrow();
  });

  it('accepts ready with optional viewType/scope contract fields', () => {
    const ready = parsePluginUiIframeMessage({
      type: 'plugin-ui.ready',
      contributionId: 'v',
      instanceId: 'i',
      viewType: 'sidebar',
      scope: 'library',
    });
    expect(ready.type).toBe('plugin-ui.ready');
    // Legacy plugins that do not send the fields still parse.
    expect(parsePluginUiIframeMessage({
      type: 'plugin-ui.ready',
      contributionId: 'v',
      instanceId: 'i',
    }).type).toBe('plugin-ui.ready');
  });
});

/* ------------------------------------------------------------------ *
 * Descriptor building
 * ------------------------------------------------------------------ */

describe('buildPluginIframeViewDescriptors', () => {
  const base = {
    pluginId: 'com.example',
    pluginInstanceId: 'inst',
    title: 'View',
  };

  it('attaches the view contract metadata and drops entries without a URL', () => {
    const built = buildPluginIframeViewDescriptors([
      { ...base, id: 'b', url: 'entry/b.html' },
      { ...base, id: 'a', url: 'entry/a.html' },
      { ...base, id: 'no-url' },
    ], 'inspector', 'library');

    expect(built).toHaveLength(2);
    expect(built[0]?.id).toBe('a'); // sorted by id
    expect(built[0]?.viewType).toBe('inspector');
    expect(built[0]?.scope).toBe('library');
  });
});
