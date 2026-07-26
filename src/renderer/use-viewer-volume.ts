import { useCallback, useEffect, useState } from "react";

import {
  clampViewerVolume,
  DEFAULT_VIEWER_VOLUME_PREFERENCES,
  loadViewerVolumePreferences,
  matchViewerVolumeKey,
  saveViewerVolumePreferences,
  stepViewerVolumeLevel,
  type ViewerVolumeDirection,
  type ViewerVolumePreferences,
} from "./viewer-volume-preferences";

export function useViewerVolume(
  enabled = true,
): {
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;
} {
  const [prefs, setPrefs] = useState<ViewerVolumePreferences>(() =>
    loadViewerVolumePreferences(),
  );

  /** Always derive next prefs from previous state so rapid drag updates never race. */
  const commit = useCallback(
    (updater: (prev: ViewerVolumePreferences) => ViewerVolumePreferences) => {
      setPrefs((prev) => {
        const next = updater(prev);
        saveViewerVolumePreferences(next);
        return next;
      });
    },
    [],
  );

  const setVolume = useCallback(
    (volume: number) => {
      const clamped = clampViewerVolume(volume);
      commit(() => ({
        version: 1,
        volume: clamped,
        muted: clamped === 0,
      }));
    },
    [commit],
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      commit((prev) => {
        if (muted) {
          return { version: 1, volume: prev.volume, muted: true };
        }
        // Unmute must restore audible gain when the slider is parked at 0.
        const volume =
          prev.volume > 0
            ? prev.volume
            : DEFAULT_VIEWER_VOLUME_PREFERENCES.volume;
        return { version: 1, volume, muted: false };
      });
    },
    [commit],
  );

  const adjustVolume = useCallback(
    (direction: ViewerVolumeDirection) => {
      commit((prev) => {
        const nextVolume = stepViewerVolumeLevel(prev.volume, direction);
        return {
          version: 1,
          volume: nextVolume,
          muted: nextVolume === 0,
        };
      });
    },
    [commit],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = matchViewerVolumeKey(event);
      if (!direction) return;
      event.preventDefault();
      event.stopPropagation();
      adjustVolume(direction);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [adjustVolume, enabled]);

  return {
    volume: prefs.volume,
    muted: prefs.muted,
    setVolume,
    setMuted,
  };
}
