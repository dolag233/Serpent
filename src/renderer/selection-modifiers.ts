/**
 * Platform-aware selection modifier keys (Serpent-b44c / Serpent-6kiw).
 *
 * macOS: toggle/range additive uses ⌘ only; Ctrl+click stays available for
 * the system context menu and must not toggle selection.
 * Windows: toggle uses Ctrl (Finder/Explorer parity).
 */

import { isMacPlatform } from "./commands/command-types";

export type SelectionPlatform = "mac" | "windows";

export function resolveSelectionPlatform(userAgent: string): SelectionPlatform {
  return isMacPlatform(userAgent) ? "mac" : "windows";
}

export function isToggleSelectionModifier(
  modifiers: { metaKey: boolean; ctrlKey: boolean },
  platform: SelectionPlatform,
): boolean {
  return platform === "mac" ? modifiers.metaKey : modifiers.ctrlKey;
}

/** Marquee additive: Shift always; toggle modifier per platform. */
export function isMarqueeAdditiveModifier(
  modifiers: {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
  },
  platform: SelectionPlatform,
): boolean {
  if (modifiers.shiftKey) return true;
  return isToggleSelectionModifier(modifiers, platform);
}

/** Marquee toggle (xor) lane: toggle modifier without Shift. */
export function isMarqueeToggleModifier(
  modifiers: {
    metaKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
  },
  platform: SelectionPlatform,
): boolean {
  return isToggleSelectionModifier(modifiers, platform) && !modifiers.shiftKey;
}
