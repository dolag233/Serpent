/**
 * Deduplicate Menu accelerator + before-input delivery of the same action.
 */

let lastForwarded: { action: string; at: number } | null = null;

export function shouldForwardViewerVideoShortcut(
  action: string,
  now = Date.now(),
): boolean {
  if (
    lastForwarded &&
    lastForwarded.action === action &&
    now - lastForwarded.at < 50
  ) {
    return false;
  }
  lastForwarded = { action, at: now };
  return true;
}

export function resetViewerVideoShortcutForwardForTests(): void {
  lastForwarded = null;
}
