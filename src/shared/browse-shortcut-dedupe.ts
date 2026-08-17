/**
 * Deduplicate Menu accelerator + before-input + renderer keydown for the
 * same browse shortcut (Serpent-g8u9).
 */

let lastForwarded: { action: string; at: number } | null = null;

export function shouldForwardBrowseShortcut(
  action: string,
  now = Date.now(),
): boolean {
  if (
    lastForwarded &&
    lastForwarded.action === action &&
    now - lastForwarded.at < 120
  ) {
    return false;
  }
  lastForwarded = { action, at: now };
  return true;
}

export function resetBrowseShortcutForwardForTests(): void {
  lastForwarded = null;
}
