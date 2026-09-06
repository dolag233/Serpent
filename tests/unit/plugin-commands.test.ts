import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pluginCommandContextSchema,
  pluginCommandInvokeSchema,
  pausePluginCommandTimeoutsForInstance,
  resumePluginCommandTimeoutsForInstance,
  startPluginCommandTimeout,
  type PluginCommandTimeoutHandle,
} from '../../src/plugins/plugin-commands';

describe('plugin command context', () => {
  it('accepts optional asset, folder, and collection ids', () => {
    expect(pluginCommandContextSchema.parse({
      targetLibraryId: 'library-1',
      assetIds: ['asset-1'],
    })).toEqual({ targetLibraryId: 'library-1', assetIds: ['asset-1'] });
    expect(pluginCommandContextSchema.parse({
      targetLibraryId: 'library-1',
      folderIds: ['folder-1'],
    })).toEqual({ targetLibraryId: 'library-1', folderIds: ['folder-1'] });
    expect(pluginCommandContextSchema.parse({
      targetLibraryId: 'library-1',
      collectionIds: ['collection-1'],
    })).toEqual({ targetLibraryId: 'library-1', collectionIds: ['collection-1'] });
    expect(pluginCommandInvokeSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      commandId: 'probe.write-folder',
      context: { targetLibraryId: 'library-1', folderIds: ['folder-1'] },
    })).toMatchObject({
      commandId: 'probe.write-folder',
      context: { targetLibraryId: 'library-1', folderIds: ['folder-1'] },
    });
  });
});

describe('plugin command timeout pause', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pauses nested host-command waits and restarts the remaining budget after the last one', () => {
    vi.useFakeTimers();
    const fires: string[] = [];
    const handle: PluginCommandTimeoutHandle = {
      instanceId: 'instance-1',
      timeoutMs: 5_000,
      timer: undefined,
      hostCommandPauseDepth: 0,
      fire: () => {
        fires.push('timeout');
      },
    };
    startPluginCommandTimeout(handle);
    vi.advanceTimersByTime(4_000);
    pausePluginCommandTimeoutsForInstance([handle], 'instance-1');
    pausePluginCommandTimeoutsForInstance([handle], 'instance-1');
    vi.advanceTimersByTime(60_000);
    expect(fires).toEqual([]);
    resumePluginCommandTimeoutsForInstance([handle], 'instance-1');
    vi.advanceTimersByTime(4_999);
    expect(fires).toEqual([]);
    resumePluginCommandTimeoutsForInstance([handle], 'instance-1');
    vi.advanceTimersByTime(4_999);
    expect(fires).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(fires).toEqual(['timeout']);
  });

  it('does not pause timeouts for another plugin instance', () => {
    vi.useFakeTimers();
    const fires: string[] = [];
    const handle: PluginCommandTimeoutHandle = {
      instanceId: 'instance-1',
      timeoutMs: 1_000,
      timer: undefined,
      hostCommandPauseDepth: 0,
      fire: () => {
        fires.push('timeout');
      },
    };
    startPluginCommandTimeout(handle);
    pausePluginCommandTimeoutsForInstance([handle], 'instance-2');
    vi.advanceTimersByTime(1_000);
    expect(fires).toEqual(['timeout']);
  });
});


describe('plugin command context', () => {
  it('accepts optional asset, folder, and collection ids', () => {
    expect(pluginCommandContextSchema.parse({
      targetLibraryId: 'library-1',
      assetIds: ['asset-1'],
    })).toEqual({ targetLibraryId: 'library-1', assetIds: ['asset-1'] });
    expect(pluginCommandContextSchema.parse({
      targetLibraryId: 'library-1',
      folderIds: ['folder-1'],
    })).toEqual({ targetLibraryId: 'library-1', folderIds: ['folder-1'] });
    expect(pluginCommandContextSchema.parse({
      targetLibraryId: 'library-1',
      collectionIds: ['collection-1'],
    })).toEqual({ targetLibraryId: 'library-1', collectionIds: ['collection-1'] });
    expect(pluginCommandInvokeSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      commandId: 'probe.write-folder',
      context: { targetLibraryId: 'library-1', folderIds: ['folder-1'] },
    })).toMatchObject({
      commandId: 'probe.write-folder',
      context: { targetLibraryId: 'library-1', folderIds: ['folder-1'] },
    });
  });
});
