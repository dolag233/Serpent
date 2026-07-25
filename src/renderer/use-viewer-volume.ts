import { useCallback, useEffect, useState } from "react";

import {
  clampViewerVolume,
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

  const persist = useCallback((next: ViewerVolumePreferences) => {
    setPrefs(next);
    saveViewerVolumePreferences(next);
  }, []);

  const setVolume = useCallback(
    (volume: number) => {
      const clamped = clampViewerVolume(volume);
      persist({
        version: 1,
        volume: clamped,
        muted: clamped === 0 ? true : prefs.muted,
      });
    },
    [persist, prefs.muted],
  );

  const setMuted = useCallback(
    (muted: boolean) => {
      persist({ version: 1, volume: prefs.volume, muted });
    },
    [persist, prefs.volume],
  );

  const adjustVolume = useCallback(
    (direction: ViewerVolumeDirection) => {
      const nextVolume = stepViewerVolumeLevel(prefs.volume, direction);
      persist({
        version: 1,
        volume: nextVolume,
        muted: nextVolume === 0,
      });
    },
    [persist, prefs.volume],
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
