/**
 * Shared platform shortcut chords (Serpent-4ojz / Serpent-vf8x peek).
 *
 * Pure data: documents the Cmd (mac) ↔ Ctrl (windows) mappings already used
 * by asset command definitions. Folder-focused keyboard dispatch still needs
 * sidebar focus wiring (Serpent-vf8x) and is intentionally not claimed here.
 *
 * Labels match menu display; matching uses metaKey/ctrlKey exactness from
 * `matchesShortcut` in the renderer command-types module.
 */

export type PlatformShortcutPlatform = "mac" | "windows";

export type PlatformShortcutChord = {
  readonly label: string;
  readonly key: string;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
};

export type PlatformShortcutRow = {
  readonly id: string;
  readonly purpose: string;
  readonly mac: PlatformShortcutChord;
  readonly windows: PlatformShortcutChord;
};

/**
 * Core cross-platform chords that do not require a Windows runner to unit-test.
 * Keep in sync with asset-commands / asset-multi-commands / global zoom.
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
