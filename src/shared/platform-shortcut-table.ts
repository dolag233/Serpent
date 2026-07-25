/**
 * Shared platform shortcut chords (Serpent-4ojz / Serpent-vf8x).
 *
 * Pure data: documents the Cmd (mac) ↔ Ctrl (windows) mappings used by
 * asset and folder command definitions. Folder keyboard dispatch reads the
 * same ShortcutSpec on sidebar commands; this table is the documented
 * cross-platform checklist for QA and unit tests.
 *
 * Labels match menu display; matching uses metaKey/ctrlKey/shiftKey
 * exactness from `matchesShortcut` in the renderer command-types module.
 */

export type PlatformShortcutPlatform = "mac" | "windows";

export type PlatformShortcutChord = {
  readonly label: string;
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
};

export type PlatformShortcutRow = {
  readonly id: string;
  readonly purpose: string;
  readonly mac: PlatformShortcutChord;
  readonly windows: PlatformShortcutChord;
};

/**
 * Core cross-platform chords that do not require a Windows runner to unit-test.
 * Keep in sync with asset-commands / sidebar-commands / global zoom.
 */
export const PLATFORM_SHORTCUT_TABLE: readonly PlatformShortcutRow[] = [
  {
    id: "asset.open-external",
    purpose: "Open selected asset in the OS default app",
    mac: { label: "⌘O", key: "o", metaKey: true },
    windows: { label: "Ctrl+O", key: "o", ctrlKey: true },
  },
  {
    id: "asset.rename",
    purpose: "Rename selected managed asset (F2 on both platforms)",
    mac: { label: "F2", key: "F2" },
    windows: { label: "F2", key: "F2" },
  },
  {
    id: "asset.move-to-trash",
    purpose: "Move selection to app trash",
    mac: { label: "⌘⌫", key: "Backspace", metaKey: true },
    windows: { label: "Delete", key: "Delete" },
  },
  {
    id: "asset.paste",
    purpose: "Paste OS clipboard files into browse folder",
    mac: { label: "⌘V", key: "v", metaKey: true },
    windows: { label: "Ctrl+V", key: "v", ctrlKey: true },
  },
  {
    id: "asset.reveal-in-folder",
    purpose: "Reveal selected asset in Finder / File Explorer",
    mac: { label: "⌘⇧S", key: "s", metaKey: true, shiftKey: true },
    windows: { label: "Ctrl+Shift+S", key: "s", ctrlKey: true, shiftKey: true },
  },
  {
    id: "asset.delete-from-disk",
    purpose: "Delete selection from disk (skip app trash)",
    mac: { label: "⌥⌘Delete", key: "Delete", metaKey: true, altKey: true },
    windows: { label: "Shift+Delete", key: "Delete", shiftKey: true },
  },
  {
    id: "workspace.focus-search",
    purpose: "Focus library search field",
    mac: { label: "⌘F", key: "f", metaKey: true },
    windows: { label: "Ctrl+F", key: "f", ctrlKey: true },
  },
  {
    id: "canvas.refresh",
    purpose: "Refresh assets from disk",
    mac: { label: "F5", key: "F5" },
    windows: { label: "F5", key: "F5" },
  },
  {
    id: "folder.create-subfolder",
    purpose: "Create a managed subfolder under the focused/browse folder",
    mac: { label: "⌘⇧N", key: "n", metaKey: true, shiftKey: true },
    windows: { label: "Ctrl+Shift+N", key: "n", ctrlKey: true, shiftKey: true },
  },
  {
    id: "folder.rename",
    purpose: "Rename focused managed folder or single selected folder card",
    mac: { label: "F2", key: "F2" },
    windows: { label: "F2", key: "F2" },
  },
  {
    id: "folder.move-to-trash",
    purpose: "Move focused managed folder to app trash",
    mac: { label: "⌘⌫", key: "Backspace", metaKey: true },
    windows: { label: "Delete", key: "Delete" },
  },
  {
    id: "canvas.zoom-in",
    purpose: "Browse card size / viewer zoom in",
    mac: { label: "⌘=", key: "=", metaKey: true },
    windows: { label: "Ctrl+=", key: "=", ctrlKey: true },
  },
  {
    id: "canvas.zoom-out",
    purpose: "Browse card size / viewer zoom out",
    mac: { label: "⌘-", key: "-", metaKey: true },
    windows: { label: "Ctrl+-", key: "-", ctrlKey: true },
  },
  {
    id: "canvas.zoom-reset",
    purpose: "Reset card size / viewer fit",
    mac: { label: "⌘0", key: "0", metaKey: true },
    windows: { label: "Ctrl+0", key: "0", ctrlKey: true },
  },
] as const;

/**
 * mac meta chords should map to windows ctrl when the physical key is the
 * same letter/digit. Platform-native substitutes (⌘⌫ → Delete) are allowed
 * without a Ctrl twin.
 */
export function windowsUsesCtrlForMacMeta(
  row: PlatformShortcutRow,
): boolean {
  if (row.id === "asset.delete-from-disk") return true;
  if (row.mac.metaKey !== true) return true;
  if (row.mac.key.toLowerCase() !== row.windows.key.toLowerCase()) {
    return row.windows.metaKey !== true;
  }
  return row.windows.ctrlKey === true && row.windows.metaKey !== true;
}

export function findPlatformShortcut(
  id: string,
): PlatformShortcutRow | undefined {
  return PLATFORM_SHORTCUT_TABLE.find((row) => row.id === id);
}
