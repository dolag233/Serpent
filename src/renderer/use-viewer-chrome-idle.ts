import { useCallback, useEffect, useRef, useState } from "react";

import {
  createViewerChromeIdleScheduler,
  shouldWakeViewerChrome,
  type ViewerChromeActivitySource,
} from "./viewer-chrome-idle";

const DEFAULT_IDLE_MS = 2_000;

/**
 * Fade viewer chrome after pointer idle (Serpent-627 / Serpent-ayf).
 *
 * Callers own the hook instance across asset navigation: mount this once at
 * a component that does not remount when the viewed asset changes (e.g. the
 * asset preview modal is remounted per-asset via a `key`, so this hook must
 * live one level up). That way switching assets never resets idle-faded
 * chrome back to visible — only `wake()` (typically called when the viewer
 * first opens) or genuine pointer movement (`onActivity("pointermove")`)
 * does.
 */
export function useViewerChromeIdle(idleMs = DEFAULT_IDLE_MS): {
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

  return { idle, onActivity, wake };
}
