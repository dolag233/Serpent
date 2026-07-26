/**
 * Serpent-32p / CANVAS-021: arm scroll snapshot on reflow triggers; commit
 * after the asset grid finishes resizing (masonry column redistribution).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";

import {
  captureCanvasBrowseScrollSnapshot,
  shouldPreferTrackedBrowseSnapshot,
  shouldUpdateTrackedBrowseSnapshot,
} from "./browse-scroll-snapshot";
import {
  installCanvasReflowScrollSpy,
  reflowDebug,
  summarizeReflowSnapshot,
} from "./canvas-reflow-debug";
import {
  cancelScheduledAnchorRestore,
  scheduleCanvasReflowRestore,
  type CanvasReflowSnapshot,
} from "./canvas-reflow-restore";
import type { BrowseViewSnapshot } from "./view-restore";
import { escapeCssAttrValue } from "./escape-css-selector";

// The panel's final React commit and the shell's release transition can
// produce one more layout pass after pointerup. Wait beyond that pass before
// declaring the restore complete.
const REFLOW_COMMIT_DEBOUNCE_MS = 200;

type ReflowArm = {
  snapshot: CanvasReflowSnapshot;
  reason: string;
};

export function useCanvasReflowRestore(
  workspaceCanvasRef: RefObject<HTMLDivElement | null>,
  assetGridRef: RefObject<HTMLDivElement | null>,
  layoutGeneration: string,
  canvasMounted: boolean,
  deferReflowCommitRef?: RefObject<boolean>,
): {
  armCanvasReflow: (
    snapshot: CanvasReflowSnapshot | null,
    reason: string,
  ) => void;
  scheduleReflowCommit: (trigger: string) => void;
  armCanvasReflowFromCanvas: (reason: string) => void;
  armCanvasReflowFromTracked: (reason: string) => void;
  restoreCanvasReflowDuringGesture: (trigger: string) => void;
  cancelPendingReflowRestore: () => void;
} {
  const reflowRestoreFrameRef = useRef<number | null>(null);
  const reflowArmRef = useRef<ReflowArm | null>(null);
  const reflowCommitTimerRef = useRef<number | null>(null);
  const trackedBrowseSnapshotRef = useRef<BrowseViewSnapshot | null>(null);
  const scrollTrackFrameRef = useRef<number | null>(null);

  const cancelPendingReflowRestore = useCallback(() => {
    if (reflowCommitTimerRef.current !== null) {
      window.clearTimeout(reflowCommitTimerRef.current);
      reflowCommitTimerRef.current = null;
    }
    cancelScheduledAnchorRestore(reflowRestoreFrameRef);
  }, []);

  const isReflowCommitDeferred = useCallback(
    () => deferReflowCommitRef?.current === true,
    [deferReflowCommitRef],
  );

  const armCanvasReflow = useCallback(
    (snapshot: CanvasReflowSnapshot | null, reason: string) => {
      if (!snapshot) {
        reflowDebug("arm-skip-empty", { reason });
        return;
      }
      const existing = reflowArmRef.current;
      if (
        existing &&
        reason.startsWith("card-size") &&
        existing.reason.startsWith("card-size")
      ) {
        reflowDebug("arm-keep-card-size-gesture", {
          reason,
          kept: summarizeReflowSnapshot(existing.snapshot),
        });
        return;
      }
      reflowArmRef.current = { snapshot, reason };
      reflowDebug("arm", {
        reason,
        snapshot: summarizeReflowSnapshot(snapshot),
      });
    },
    [],
  );

  const armCanvasReflowFromTracked = useCallback(
    (reason: string) => {
      const tracked = trackedBrowseSnapshotRef.current;
      if (!tracked) {
        reflowDebug("arm-tracked-miss", { reason });
        return;
      }
      armCanvasReflow(tracked, reason);
    },
    [armCanvasReflow],
  );

  const armCanvasReflowFromCanvas = useCallback(
    (reason: string) => {
      const canvas = workspaceCanvasRef.current;
      if (!canvas) {
        reflowDebug("arm-canvas-miss", { reason });
        return;
      }
      const tracked = trackedBrowseSnapshotRef.current;
      const live = captureCanvasBrowseScrollSnapshot(canvas);
      const trackedAnchorPresent = tracked?.anchor
        ? Boolean(
            canvas.querySelector(
              `[data-asset-id="${escapeCssAttrValue(tracked.anchor.assetId)}"]`,
            ),
          )
        : false;
      const preferTracked = shouldPreferTrackedBrowseSnapshot(
        canvas.scrollTop,
        tracked,
        trackedAnchorPresent,
      );
      const snapshot = preferTracked ? tracked : live;
      if (preferTracked) {
        reflowDebug("arm-use-tracked", {
          reason,
          liveScrollTop: canvas.scrollTop,
          tracked: summarizeReflowSnapshot(tracked),
        });
      }
      armCanvasReflow(snapshot, reason);
    },
    [armCanvasReflow, workspaceCanvasRef],
  );

  const commitCanvasReflowRestore = useCallback((trigger: string) => {
    const canvas = workspaceCanvasRef.current;
    const arm = reflowArmRef.current;
    if (!canvas || !arm) {
      reflowDebug("commit-skip", {
        trigger,
        hasCanvas: Boolean(canvas),
        armed: Boolean(arm),
      });
      return;
    }

    reflowDebug("commit", {
      trigger,
      armReason: arm.reason,
      scrollTopBefore: canvas.scrollTop,
      scrollHeight: canvas.scrollHeight,
      clientHeight: canvas.clientHeight,
      snapshot: summarizeReflowSnapshot(arm.snapshot),
    });

    scheduleCanvasReflowRestore(canvas, arm.snapshot, reflowRestoreFrameRef, {
      debugLabel: `${arm.reason}/${trigger}`,
      // A gesture-end commit must write the captured position immediately.
      // Delaying the first pass leaves the canvas visibly at scrollTop=0
      // while React finishes the card layout.
      settleFrames: 0,
      maxPasses: 60,
      stablePasses: 5,
      onComplete: (result) => {
        if (isReflowCommitDeferred()) {
          reflowDebug("disarm-skipped-gesture-active", { trigger, ...result });
          return;
        }
        if (result.success) {
          reflowArmRef.current = null;
          reflowDebug("disarm-success", { trigger, ...result });
          return;
        }
        reflowDebug("remain-armed", { trigger, ...result });
      },
    });
  }, [isReflowCommitDeferred, workspaceCanvasRef]);

  const restoreCanvasReflowDuringGesture = useCallback(
    (trigger: string) => {
      if (!isReflowCommitDeferred()) return;
      const canvas = workspaceCanvasRef.current;
      const arm = reflowArmRef.current;
      if (!canvas || !arm) return;
      reflowDebug("gesture-restore", {
        trigger,
        armReason: arm.reason,
        scrollTopBefore: canvas.scrollTop,
        snapshot: summarizeReflowSnapshot(arm.snapshot),
      });
      scheduleCanvasReflowRestore(canvas, arm.snapshot, reflowRestoreFrameRef, {
        debugLabel: `${arm.reason}/${trigger}`,
        settleFrames: 0,
        maxPasses: 1,
        stablePasses: 1,
      });
    },
    [isReflowCommitDeferred, workspaceCanvasRef],
  );

  const scheduleReflowCommit = useCallback(
    (trigger: string) => {
      if (!reflowArmRef.current) return;
      if (isReflowCommitDeferred()) {
        reflowDebug("commit-deferred", { trigger });
        restoreCanvasReflowDuringGesture(trigger);
        return;
      }
      if (trigger.endsWith("-end") || trigger.endsWith("-end-pointer")) {
        if (reflowCommitTimerRef.current !== null) {
          window.clearTimeout(reflowCommitTimerRef.current);
          reflowCommitTimerRef.current = null;
        }
        commitCanvasReflowRestore(trigger);
        return;
      }
      if (reflowCommitTimerRef.current !== null) {
        window.clearTimeout(reflowCommitTimerRef.current);
      }
      reflowCommitTimerRef.current = window.setTimeout(() => {
        reflowCommitTimerRef.current = null;
        commitCanvasReflowRestore(trigger);
      }, REFLOW_COMMIT_DEBOUNCE_MS);
    },
    [
      commitCanvasReflowRestore,
      isReflowCommitDeferred,
      restoreCanvasReflowDuringGesture,
    ],
  );

  useEffect(
    () => () => {
      if (reflowCommitTimerRef.current !== null) {
        window.clearTimeout(reflowCommitTimerRef.current);
      }
      if (scrollTrackFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollTrackFrameRef.current);
      }
      cancelScheduledAnchorRestore(reflowRestoreFrameRef);
    },
    [],
  );

  useEffect(() => {
    reflowDebug("enabled", {
      hint: "Filter console by [canvas-reflow]. Export: copy(sessionStorage.getItem('SERPENT_REFLOW_LOG')). Disable: localStorage.setItem('SERPENT_REFLOW_DEBUG','0')",
    });
  }, []);

  useEffect(() => {
    const canvas = workspaceCanvasRef.current;
    if (!canvas || !canvasMounted) return;

    reflowDebug("scroll-spy-install");
    const disposeSpy = installCanvasReflowScrollSpy(
      canvas,
      () => reflowArmRef.current !== null,
    );

    const trackSnapshot = () => {
      const next = captureCanvasBrowseScrollSnapshot(canvas);
      if (!next) return;
      const previous = trackedBrowseSnapshotRef.current;
      if (
        !shouldUpdateTrackedBrowseSnapshot(
          previous,
          next,
          reflowArmRef.current !== null,
        )
      ) {
        reflowDebug("tracked-ignore-jump-to-top", {
          previousScrollTop: previous?.scrollTop ?? null,
          nextScrollTop: next.scrollTop,
        });
        return;
      }
      trackedBrowseSnapshotRef.current = next;
    };

    const onScroll = () => {
      if (scrollTrackFrameRef.current !== null) return;
      scrollTrackFrameRef.current = window.requestAnimationFrame(() => {
        scrollTrackFrameRef.current = null;
        trackSnapshot();
      });
    };

    trackSnapshot();
    canvas.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      disposeSpy();
      canvas.removeEventListener("scroll", onScroll);
    };
  }, [workspaceCanvasRef, canvasMounted]);

  useLayoutEffect(() => {
    const grid = assetGridRef.current;
    if (!grid) return;
    const observer = new ResizeObserver(() => {
      if (reflowArmRef.current) {
        scheduleReflowCommit("asset-grid-resize");
      }
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [assetGridRef, scheduleReflowCommit, canvasMounted]);

  useLayoutEffect(() => {
    if (!reflowArmRef.current) return;
    scheduleReflowCommit("layout-generation");
  }, [layoutGeneration, scheduleReflowCommit]);

  return {
    armCanvasReflow,
    scheduleReflowCommit,
    armCanvasReflowFromCanvas,
    armCanvasReflowFromTracked,
    restoreCanvasReflowDuringGesture,
    cancelPendingReflowRestore,
  };
}
