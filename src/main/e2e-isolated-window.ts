/**
 * Pure geometry for `SERPENT_E2E_ISOLATED=1`: picks a non-primary display and
 * a window rectangle fully contained within it, so the real Electron E2E
 * suite can `show()` its window normally (preserving real focus/keyboard
 * semantics) without covering the user's primary display.
 *
 * Electron-free so vitest can exercise it directly; the caller in
 * `src/main/index.ts` supplies plain display data read from
 * `electron.screen`.
 *
 * See docs/internal/development/2026-07-19-e2e-isolated-session-development-log.md
 * for why this replaced the earlier `BrowserWindow.showInactive` attempt.
 */

export interface DisplayBoundsLike {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  bounds: DisplayBoundsLike;
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface IsolatedWindowPlacement {
  displayId: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Returns a window rectangle centered within the first available
 * non-primary display, clamped so the window never extends past that
 * display's bounds. Returns `undefined` when only one display is present
 * (the documented residual limitation: single-display Macs still show the
 * E2E window on the primary display and it can steal foreground focus).
 */
export function pickIsolatedWindowPlacement(
  displays: readonly DisplayLike[],
  primaryDisplayId: number,
  preferredSize: WindowSize,
): IsolatedWindowPlacement | undefined {
  const secondary = displays.find((display) => display.id !== primaryDisplayId);
  if (!secondary) return undefined;

  const width = Math.max(1, Math.min(preferredSize.width, secondary.bounds.width));
  const height = Math.max(1, Math.min(preferredSize.height, secondary.bounds.height));
  const x = secondary.bounds.x + Math.floor((secondary.bounds.width - width) / 2);
  const y = secondary.bounds.y + Math.floor((secondary.bounds.height - height) / 2);

  return { displayId: secondary.id, x, y, width, height };
}
