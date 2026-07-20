import { BrowserWindow, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';

import {
  buildEditContextMenuTemplate,
  parseShowEditContextMenuRequest,
  type ShowEditContextMenuResult,
} from '../shared/edit-context-menu';

/**
 * Popup the platform edit context menu for the focused text field.
 * Roles own enable/disable and platform accelerators; this never executes
 * arbitrary Renderer-supplied commands.
 */
export function popupEditContextMenu(
  webContents: WebContents,
  input: unknown,
): ShowEditContextMenuResult {
  const request = parseShowEditContextMenuRequest(input);
  if (!request) {
    return { ok: false, code: 'malformed_request' };
  }

  const window = BrowserWindow.fromWebContents(webContents);
  if (!window || window.isDestroyed()) {
    return { ok: false, code: 'no_window' };
  }

  const menu = Menu.buildFromTemplate(
    buildEditContextMenuTemplate() as MenuItemConstructorOptions[],
  );
  menu.popup({
    window,
    x: Math.round(request.x),
    y: Math.round(request.y),
  });
  return { ok: true };
}
