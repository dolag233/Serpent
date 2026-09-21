import type { WorkerRequest } from '../../shared/protocol/requests';
import type { WorkerResult } from '../../shared/protocol/responses';
import {
  VIEWPORT_PREEMPT_STABLE_MS,
  resolveViewportClaimIds,
  shouldAbortRunningOutsideViewport,
  type ViewportPriorityOverlay,
} from '../../shared/viewport-priority';
import { shouldPreemptVisibleWindow } from '../visible-window-policy';
import type { LibraryService } from '../library-service';

export type VisibleWindowRuntime = {
  startupThumbnailVisibleWindows: Set<string>;
  deferredStartupThumbnailGenerations: Map<string, number>;
  startDeferredStartupThumbnailScene: (libraryId: string, libraryGeneration: number) => void;
  viewportPriorityOverlay: ViewportPriorityOverlay;
  currentLibraryGeneration: (libraryId: string) => number | undefined;
  lastVisibleWindowKeyByLibrary: Map<string, string>;
  lastVisibleWindowAssetIdsByLibrary: Map<string, string[]>;
  lastViewportVisibleChangeAtMs: Map<string, number>;
  lastViewportPreemptAtMs: Map<string, number>;
  activeThumbnailQueueAssetScopes: Map<string, { current: string[] | undefined }>;
  setImmediateAssetIds: (libraryId: string, assetIds: string[]) => void;
  hasIdleForegroundImageSlot: () => boolean;
  scheduleVisibleThumbnails: (
    libraryId: string,
    assetIds: string[],
    preemptVisible: boolean,
  ) => void;
  enqueueVisibleWindowDimensionProbes: (libraryId: string, assetIds: string[]) => void;
};

export function executeVisibleWindowWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  runtime: VisibleWindowRuntime,
): WorkerResult | undefined {
  if (request.command.type !== 'asset.thumbnail.visible-window') return undefined;

  // Serpent-visible-window: the renderer reports what the user is actually
  // looking at after scrolling. Two effects, both cheap:
  // 1) queue-jump — the visible wave (350, light) boosts these assets'
  //    and restricts the next queue claim to them, so the current viewport
  //    finishes first no matter how the queue was filled;
  // 2) placeholder sizing — header-probe dimensions land immediately so
  //    masonry placeholders stop reflowing when thumbnails finish later.
  const { libraryId, assetIds } = request.command;
  runtime.startupThumbnailVisibleWindows.add(libraryId);
  const deferredGeneration = runtime.deferredStartupThumbnailGenerations.get(libraryId);
  if (deferredGeneration !== undefined) {
    runtime.startDeferredStartupThumbnailScene(libraryId, deferredGeneration);
  }
  // Serpent-4bc4ac: ignored assets are not indexed or operated on —
  // drop them before dimension probes and thumbnail scheduling.
  const focusedRaw = request.command.focusedAssetIds ?? [];
  const nearForwardRaw = request.command.nearForwardAssetIds ?? [];
  const nearBackwardRaw = request.command.nearBackwardAssetIds ?? [];
  const scopeWarmRaw = request.command.scopeWarmAssetIds ?? [];
  const allowedAssetIds = new Set(libraryService.filterIgnoredAssetIds(
    libraryId,
    [...assetIds, ...focusedRaw, ...nearForwardRaw, ...nearBackwardRaw, ...scopeWarmRaw],
  ));
  const keepAllowed = (ids: readonly string[]): string[] => {
    const kept: string[] = [];
    const seen = new Set<string>();
    for (const assetId of ids) {
      if (!assetId || seen.has(assetId) || !allowedAssetIds.has(assetId)) continue;
      seen.add(assetId);
      kept.push(assetId);
    }
    return kept;
  };
  const visibleAssetIds = keepAllowed(assetIds);
  const focusedAssetIds = keepAllowed(focusedRaw);
  const nearForwardAssetIds = keepAllowed(nearForwardRaw);
  const nearBackwardAssetIds = keepAllowed(nearBackwardRaw);
  const scopeWarmAssetIds = keepAllowed(scopeWarmRaw);
  // The renderer order is meaningful for the first visual wave (top to
  // bottom), while the key and overlap calculation are set-like. Keep the
  // stable key sorted without destroying the caller's scheduling order.
  const visibleWindowKey = [...visibleAssetIds].toSorted().join('\u0000');
  const viewportGeneration = request.command.viewportGeneration;
  const consumerId = request.command.consumerId ?? 'browse';
  const bandSnapshotAccepted = runtime.viewportPriorityOverlay.apply({
    libraryId,
    consumerId,
    libraryGeneration: request.command.libraryGeneration
      ?? runtime.currentLibraryGeneration(libraryId)
      ?? 0,
    interactionGeneration: request.command.interactionGeneration ?? 0,
    viewportGeneration: viewportGeneration ?? Date.now(),
    direction: request.command.direction ?? 'stationary',
    focused: focusedAssetIds,
    visible: visibleAssetIds,
    nearForward: nearForwardAssetIds,
    nearBackward: nearBackwardAssetIds,
    scopeWarm: scopeWarmAssetIds,
  });
  if (!bandSnapshotAccepted.accepted) {
    return { ok: true, type: 'asset.thumbnail.visible-window.acknowledged' };
  }
  if (
    viewportGeneration === undefined
    && visibleWindowKey === runtime.lastVisibleWindowKeyByLibrary.get(libraryId)
  ) {
    return { ok: true, type: 'asset.thumbnail.visible-window.acknowledged' };
  }
  const previousVisible = runtime.lastVisibleWindowAssetIdsByLibrary.get(libraryId);
  const previousVisibleKey = runtime.lastVisibleWindowKeyByLibrary.get(libraryId);
  const visibleSetChanged = visibleWindowKey !== previousVisibleKey;
  const overlapShouldPreempt = shouldPreemptVisibleWindow(
    previousVisible,
    visibleAssetIds,
  );
  const nowMs = Date.now();
  const viewportStableMs = previousVisible === undefined
    ? VIEWPORT_PREEMPT_STABLE_MS
    : visibleSetChanged
      ? 0
      : Math.max(0, nowMs - (runtime.lastViewportVisibleChangeAtMs.get(libraryId) ?? nowMs));
  if (visibleSetChanged) runtime.lastViewportVisibleChangeAtMs.set(libraryId, nowMs);
  runtime.lastVisibleWindowKeyByLibrary.set(libraryId, visibleWindowKey);
  runtime.lastVisibleWindowAssetIdsByLibrary.set(libraryId, visibleAssetIds);
  const rankedClaimIds = runtime.viewportPriorityOverlay.rankedClaimIds(libraryId);
  const assetScope = runtime.activeThumbnailQueueAssetScopes.get(libraryId);
  if (assetScope) {
    assetScope.current = resolveViewportClaimIds(rankedClaimIds, visibleAssetIds);
  }
  runtime.setImmediateAssetIds(
    libraryId,
    runtime.viewportPriorityOverlay.immediateAssetIds(libraryId),
  );
  const preemptVisible = shouldAbortRunningOutsideViewport({
    overlapShouldPreempt,
    hasIdleForegroundSlot: runtime.hasIdleForegroundImageSlot(),
    viewportStableMs,
    lastPreemptAtMs: runtime.lastViewportPreemptAtMs.get(libraryId),
    nowMs,
    p0OrP1Waiting: runtime.viewportPriorityOverlay.immediateAssetIds(libraryId).length > 0,
    lookaheadOnly: previousVisible !== undefined && !visibleSetChanged,
  });
  if (preemptVisible) {
    libraryService.interruptThumbnailJobsOutsideViewport(libraryId, visibleAssetIds);
    runtime.lastViewportPreemptAtMs.set(libraryId, nowMs);
  }
  // Models use Main's single-flight offscreen renderer. Keep that
  // potentially slow/timeout-prone work out of the fast visible raster
  // wave so it cannot occupy one of the two Worker queue slots while the
  // user-visible image/video cards are being filled. Startup and mutation
  // scenes still process model jobs in the background, and an explicit
  // model preview request still uses the normal visible hint.
  const fastVisibleAssetIds = libraryService.filterVisibleThumbnailAssetIds(
    libraryId,
    visibleAssetIds,
  );
  if (fastVisibleAssetIds.length > 0) {
    runtime.scheduleVisibleThumbnails(libraryId, fastVisibleAssetIds, preemptVisible);
  }
  // Header probes used to run synchronously here, before the ACK. On a
  // cold/remote volume that made a scroll report monopolize the Worker
  // behind dozens of open/read/close calls and delayed the next page
  // query. Keep the geometry correction, but drain it asynchronously after
  // this command has returned and let it be cancelled on library close.
  runtime.enqueueVisibleWindowDimensionProbes(libraryId, visibleAssetIds);
  return { ok: true, type: 'asset.thumbnail.visible-window.acknowledged' };
}
