import { expect, test, vi } from 'vitest';

import { executeVisibleWindowWorkerCommand } from '../../src/worker/handlers/visible-window';
import type { VisibleWindowRuntime } from '../../src/worker/handlers/visible-window';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';
import { ViewportPriorityOverlay } from '../../src/shared/viewport-priority';

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
  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).not.toHaveBeenCalled();
});

test('visible-window schedules a light visible wave for newly reported assets', () => {
  const libraryService = {
    filterIgnoredAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    filterVisibleThumbnailAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    interruptThumbnailJobsOutsideViewport: vi.fn(),
  } as unknown as LibraryService;
  const overlay = {
    apply: vi.fn(() => ({ accepted: true })),
    rankedClaimIds: vi.fn(() => []),
    immediateAssetIds: vi.fn(() => ['asset-1', 'asset-2']),
  } as unknown as ViewportPriorityOverlay;
  const windowRuntime = runtime({ viewportPriorityOverlay: overlay });

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

test('visible-window dimension probes use the latest immediate union across consumers', () => {
  const libraryService = {
    filterIgnoredAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    filterVisibleThumbnailAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    interruptThumbnailJobsOutsideViewport: vi.fn(),
  } as unknown as LibraryService;
  const windowRuntime = runtime({ viewportPriorityOverlay: new ViewportPriorityOverlay() });

  const dispatch = (command: WorkerRequest['command']) => executeVisibleWindowWorkerCommand(
    libraryService,
    visibleWindowRequest(command),
    windowRuntime,
  );

  dispatch({
    type: 'asset.thumbnail.visible-window',
    libraryId: 'lib-1',
    consumerId: 'canvas',
    libraryGeneration: 1,
    viewportGeneration: 1,
    focusedAssetIds: ['focus-canvas'],
    assetIds: ['visible-canvas'],
  });
  dispatch({
    type: 'asset.thumbnail.visible-window',
    libraryId: 'lib-1',
    consumerId: 'inspector',
    libraryGeneration: 1,
    viewportGeneration: 1,
    focusedAssetIds: ['focus-inspector'],
    assetIds: ['visible-inspector'],
  });
  dispatch({
    type: 'asset.thumbnail.visible-window',
    libraryId: 'lib-1',
    consumerId: 'canvas',
    libraryGeneration: 1,
    viewportGeneration: 2,
    focusedAssetIds: ['focus-canvas-next'],
    assetIds: ['visible-canvas-next'],
  });

  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenNthCalledWith(
    1,
    'lib-1',
    ['focus-canvas', 'visible-canvas'],
  );
  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenNthCalledWith(
    2,
    'lib-1',
    ['focus-canvas', 'visible-canvas', 'focus-inspector', 'visible-inspector'],
  );
  // Replacing canvas keeps inspector's still-current assets in the union.
  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenNthCalledWith(
    3,
    'lib-1',
    ['focus-canvas-next', 'visible-canvas-next', 'focus-inspector', 'visible-inspector'],
  );
  expect(windowRuntime.setImmediateAssetIds).toHaveBeenNthCalledWith(
    3,
    'lib-1',
    ['focus-canvas-next', 'visible-canvas-next', 'focus-inspector', 'visible-inspector'],
  );

  dispatch({
    type: 'asset.thumbnail.visible-window',
    libraryId: 'lib-1',
    consumerId: 'canvas',
    libraryGeneration: 1,
    viewportGeneration: 1,
    focusedAssetIds: ['stale-focus'],
    assetIds: ['stale-visible'],
  });
  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenCalledTimes(3);
});

test('visible-window re-enqueues a same-visible focus update before the legacy early return', () => {
  const libraryService = {
    filterIgnoredAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    filterVisibleThumbnailAssetIds: vi.fn((_libraryId: string, assetIds: string[]) => assetIds),
    interruptThumbnailJobsOutsideViewport: vi.fn(),
  } as unknown as LibraryService;
  const windowRuntime = runtime({ viewportPriorityOverlay: new ViewportPriorityOverlay() });

  const dispatch = (focusedAssetId: string) => executeVisibleWindowWorkerCommand(
    libraryService,
    visibleWindowRequest({
      type: 'asset.thumbnail.visible-window',
      libraryId: 'lib-1',
      consumerId: 'legacy-canvas',
      focusedAssetIds: [focusedAssetId],
      assetIds: ['same-visible-asset'],
    }),
    windowRuntime,
  );

  dispatch('focus-before');
  dispatch('focus-after');

  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenNthCalledWith(
    1,
    'lib-1',
    ['focus-before', 'same-visible-asset'],
  );
  expect(windowRuntime.enqueueVisibleWindowDimensionProbes).toHaveBeenNthCalledWith(
    2,
    'lib-1',
    ['focus-after', 'same-visible-asset'],
  );
  expect(windowRuntime.scheduleVisibleThumbnails).toHaveBeenCalledTimes(1);
});
