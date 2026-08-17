import {
  isDialogEscapeLayerActive,
  type DialogEscapeSnapshot,
} from './dialog-escape-stack';
import { isModalDialogOpen } from './workspace-mouse-navigation';

/**
 * Whether a Host/system modal layer is active. Dialogs outrank plugin input
 * capture (0024): Main pauses delivery while active and resumes when closed.
 */
export function resolvePluginInputCaptureSystemModalActive(
  snapshot: DialogEscapeSnapshot,
  options?: { readonly domModalOpen?: boolean },
): boolean {
  return isDialogEscapeLayerActive(snapshot) || (options?.domModalOpen ?? false);
}

export function isPluginInputCaptureSystemModalDomOpen(
  doc: Document = document,
): boolean {
  return isModalDialogOpen(doc);
}
