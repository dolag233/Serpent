import { useEffect } from 'react';

import { isEditableTextTarget } from '../shared/edit-context-menu';
import { useContextMenu } from './context-menu';

type RendererWindow = Window & {
  serpent?: {
    shell?: {
      showEditContextMenu?: (point: {
        x: number;
        y: number;
      }) => Promise<unknown>;
    };
  };
};

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"]';

/**
 * Document capture listener: right-click on text inputs/textareas pops the
 * Main-owned native edit menu and stops the event so asset/folder React
 * context menus do not open (Serpent-d8u).
 *
 * Mount inside `<ContextMenuProvider>` so any open React menu is closed first.
 */
export function EditTextContextMenuHost() {
  const { close: closeContextMenu } = useContextMenu();

  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      if (!isEditableTextTarget(event.target)) return;

      const show =
        (window as RendererWindow).serpent?.shell?.showEditContextMenu;
      if (typeof show !== 'function') return;

      event.preventDefault();
      event.stopPropagation();
      closeContextMenu();

      // Ensure Electron edit roles evaluate this field (not a previous focus).
      if (event.target instanceof Element) {
        const editable = event.target.closest(EDITABLE_SELECTOR);
        if (
          editable instanceof HTMLElement &&
          document.activeElement !== editable
        ) {
          editable.focus();
        }
      }

      void show({ x: event.clientX, y: event.clientY });
    };

    // Capture: run before React delegated bubble handlers on asset cards etc.
    document.addEventListener('contextmenu', onContextMenu, true);
    return () => {
      document.removeEventListener('contextmenu', onContextMenu, true);
    };
  }, [closeContextMenu]);

  return null;
}
