import { expect, test, vi } from 'vitest';

import { executeVisibleWindowWorkerCommand } from '../../src/worker/handlers/visible-window';
import type { VisibleWindowRuntime } from '../../src/worker/handlers/visible-window';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';
import type { ViewportPriorityOverlay } from '../../src/shared/viewport-priority';

function visibleWindowRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

function runtime(overrides: Partial<VisibleWindowRuntime> = {}): VisibleWindowRuntime {
  return {
    startupThumbnailVisibleWindows: new Set(),
    deferredStartupThumbnailGenerations: new Map(),
    startDeferredStartupThumbnailScene: vi.fn(),
    viewportPriorityOverlay: {
      apply: vi.fn(() => ({ accepted: true })),
      rankedClaimIds: vi.fn(() => []),
      immediateAssetIds: vi.fn(() => []),
    } as unknown as ViewportPriorityOverlay,
    currentLibraryGeneration: vi.fn(() => 1),
    lastVisibleWindowKeyByLibrary: new Map(),
    lastVisibleWindowAssetIdsByLibrary: new Map(),
    lastViewportVisibleChangeAtMs: new Map(),
    lastViewportPreemptAtMs: new Map(),
    activeThumbnailQueueAssetScopes: new Map(),
    setImmediateAssetIds: vi.fn(),
    hasIdleForegroundImageSlot: vi.fn(() => true),
    scheduleVisibleThumbnails: vi.fn(),
    enqueueVisibleWindowDimensionProbes: vi.fn(),
    ...overrides,
  };
}

test('visible-window acknowledges stale overlay snapshots without scheduling', () => {
  const overlay = {
    apply: vi.fn(() => ({ accepted: false })),
    rankedClaimIds: vi.fn(() => []),
    immediateAssetIds: vi.fn(() => []),
  } as unknown as ViewportPriorityOverlay;
  const windowRuntime = runtime({ viewportPriorityOverlay: overlay });
  const libraryService = {
    filterIgnoredAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
  } as unknown as LibraryService;

  expect(executeVisibleWindowWorkerCommand(
    libraryService,
    visibleWindowRequest({
      type: 'asset.thumbnail.visible-window',
      libraryId: 'lib-1',
      assetIds: ['asset-1'],
    }),
    windowRuntime,
  )).toEqual({
    ok: true,
    type: 'asset.thumbnail.visible-window.acknowledged',
  });
  expect(windowRuntime.scheduleVisibleThumbnails).not.toHaveBeenCalled();
});

test('visible-window schedules a light visible wave for newly reported assets', () => {
  const libraryService = {
    filterIgnoredAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    filterVisibleThumbnailAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    interruptThumbnailJobsOutsideViewport: vi.fn(),
  } as unknown as LibraryService;
  const windowRuntime = runtime();

  expect(executeVisibleWindowWorkerCommand(
    libraryService,
    visibleWindowRequest({
      type: 'asset.thumbnail.visible-window',
      libraryId: 'lib-1',
      assetIds: ['asset-1', 'asset-2'],
      viewportGeneration: 4,
    }),
    windowRuntime,
  )).toEqual({
    ok: true,
    type: 'asset.thumbnail.visible-window.acknowledged',
  });
  expect(windowRuntime.scheduleVisibleThumbnails).toHaveBeenCalledWith(
    'lib-1',
    ['asset-1', 'asset-2'],
    expect.any(Boolean),
  );
  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenCalledWith(
    'lib-1',
    ['asset-1', 'asset-2'],
  );
});
