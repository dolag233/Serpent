/**
 * Workspace back/forward via mouse side buttons (Serpent-1xmk / REQ-NAV-007).
 *
 * Pure helpers — useWorkspaceMouseNavigation owns the window listener.
 */

export type WorkspaceMouseNavAction = "back" | "forward";

export function isEditableMouseNavTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function isModalDialogOpen(doc: Document = document): boolean {
  return Boolean(doc.querySelector('[role="dialog"][aria-modal="true"]'));
}

/** Chromium/Electron: button 3 = back (XButton1), 4 = forward (XButton2). */
export function resolveWorkspaceMouseNavButton(
  button: number,
): WorkspaceMouseNavAction | null {
  if (button === 3) return "back";
  if (button === 4) return "forward";
  return null;
}

export function resolveWorkspaceMouseNavAction(
  event: Pick<MouseEvent, "button" | "target">,
  options?: { readonly isModalOpen?: boolean },
): WorkspaceMouseNavAction | null {
  const isModalOpen = options?.isModalOpen ?? isModalDialogOpen();
  if (isModalOpen) return null;
  if (isEditableMouseNavTarget(event.target)) return null;
  return resolveWorkspaceMouseNavButton(event.button);
}
