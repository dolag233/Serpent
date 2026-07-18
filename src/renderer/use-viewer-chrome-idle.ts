import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_IDLE_MS = 2_000;

/**
 * Fade viewer chrome after pointer idle. Any move/down on the viewer bumps
 * visibility; hovering chrome itself also counts as activity via bubbling.
 */
export function useViewerChromeIdle(idleMs = DEFAULT_IDLE_MS): {
  idle: boolean;
  onPointerActivity: () => void;
} {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | 0>(0);

  const onPointerActivity = useCallback(() => {
    setIdle(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIdle(true);
    }, idleMs);
  }, [idleMs]);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setIdle(true);
    }, idleMs);
    return () => clearTimeout(timerRef.current);
  }, [idleMs]);

  return { idle, onPointerActivity };
}
