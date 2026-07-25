import { useCallback, useEffect, useRef, useState } from "react";

import {
  createViewerChromeIdleScheduler,
  shouldWakeViewerChrome,
  type ViewerChromeActivitySource,
} from "./viewer-chrome-idle";

const DEFAULT_IDLE_MS = 2_000;

/**
 * Fade viewer chrome after input idle (Serpent-627 / Serpent-njoy).
 *
 * Callers own the hook instance across asset navigation: mount this once at
 * a component that does not remount when the viewed asset changes (e.g. the
 * asset preview modal is remounted per-asset via a `key`, so this hook must
 * live one level up). Opening the viewer calls `wake()`; while `active`,
 * window-level capture listeners wake chrome on any keyboard / pointer /
 * wheel input.
 */
export function useViewerChromeIdle(
  idleMs = DEFAULT_IDLE_MS,
  active = false,
): {
  idle: boolean;
  onActivity: (source: ViewerChromeActivitySource) => void;
  wake: () => void;
} {
  const [idle, setIdle] = useState(false);
  const schedulerRef = useRef<ReturnType<
    typeof createViewerChromeIdleScheduler
  > | null>(null);

  useEffect(() => {
    const scheduler = createViewerChromeIdleScheduler(
      idleMs,
      () => setIdle(true),
      () => setIdle(false),
    );
    schedulerRef.current = scheduler;
    scheduler.bump();
    return () => {
      scheduler.dispose();
      schedulerRef.current = null;
    };
  }, [idleMs]);

  const wake = useCallback(() => {
    schedulerRef.current?.bump();
  }, []);

  const onActivity = useCallback(
    (source: ViewerChromeActivitySource) => {
      if (!shouldWakeViewerChrome(source)) return;
      wake();
    },
    [wake],
  );

  // While the viewer is open, any user input interrupts chrome fade.
  useEffect(() => {
    if (!active) return;

    const onKey = () => onActivity("keyboard");
    const onPointerMove = () => onActivity("pointermove");
    const onPointerDown = () => onActivity("pointerdownOrClick");
    const onWheel = () => onActivity("wheel");

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });

    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, [active, onActivity]);

  return { idle, onActivity, wake };
}
