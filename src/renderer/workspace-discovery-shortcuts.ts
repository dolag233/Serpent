/**
 * Discovery toolbar chords (Serpent-x78x / REQ-COMMAND-004).
 *
 * Pure match helpers — useBrowseCommandKeyboard owns the DOM listener.
 */

import {
  matchesShortcut,
  type CommandPlatform,
  type ShortcutEvent,
  type ShortcutSpec,
} from "./commands/command-types";

/** Focus the library search field: ⌘F / Ctrl+F. */
export const FOCUS_SEARCH_SHORTCUT: ShortcutSpec = {
  mac: { label: "⌘F", key: "f", metaKey: true },
  windows: { label: "Ctrl+F", key: "f", ctrlKey: true },
};

export function matchFocusSearchShortcut(
  event: ShortcutEvent,
  platform: CommandPlatform,
): boolean {
  return matchesShortcut(FOCUS_SEARCH_SHORTCUT, event, platform);
}

export function isLibrarySearchInput(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement &&
    target.classList.contains("search-control")
  );
}
