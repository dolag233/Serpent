import { BrowserWindow, ipcMain, type WebContents } from "electron";

import {
  WINDOW_CONTROL_CHANNEL,
  WINDOW_MAXIMIZED_CHANNEL,
} from "../shared/protocol/channels";
import {
  parseWindowControlRequest,
  shouldHideWindowOnClose,
  shouldUseFramelessTitleBar,
  type WindowControlResult,
  type WindowMaximizedStateEvent,
} from "../shared/window-controls";

type WindowControlLogger = {
  info: (scope: string, message: string, meta?: Record<string, unknown>) => void;
};

function sendMaximizedState(webContents: WebContents, maximized: boolean): void {
  if (webContents.isDestroyed()) return;
  const event: WindowMaximizedStateEvent = {
    type: "shell.window.maximized",
    maximized,
  };
  webContents.send(WINDOW_MAXIMIZED_CHANNEL, event);
}

function applyWindowControl(
  window: BrowserWindow,
  action: "minimize" | "maximize-toggle" | "close" | "get-state",
): WindowControlResult {
  if (window.isDestroyed()) {
    return { ok: false, code: "no_window" };
  }
  switch (action) {
    case "minimize":
      window.minimize();
      break;
    case "maximize-toggle":
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
      break;
    case "close":
      // Do not read isMaximized() after close — the window may already be destroyed.
      // On Windows the renderer owns the caption buttons. Closing the visible
      // window hides it and leaves the process alive behind the notification-area
      // tray icon; the tray menu owns the explicit quit action.
      if (shouldHideWindowOnClose(process.platform)) window.hide();
      else window.close();
      return { ok: true, maximized: false };
    case "get-state":
      break;
  }
  if (window.isDestroyed()) {
    return { ok: true, maximized: false };
  }
  return { ok: true, maximized: window.isMaximized() };
}

/**
 * Register frameless Windows caption IPC and wire maximize state events
 * onto the given main window (Serpent-znex).
 */
export function registerWindowControls(options: {
  getMainWindow: () => BrowserWindow | undefined;
  logger?: WindowControlLogger;
}): void {
  const { getMainWindow, logger } = options;

  ipcMain.handle(
    WINDOW_CONTROL_CHANNEL,
    (event, input: unknown): WindowControlResult => {
      if (!shouldUseFramelessTitleBar(process.platform)) {
        logger?.info("ipc.window-control", "Rejected window-control request.", {
          code: "unsupported_platform",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const mainWindow = getMainWindow();
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        logger?.info("ipc.window-control", "Rejected window-control request.", {
          code: "unauthorized_sender",
        });
        return { ok: false, code: "unauthorized_sender" };
      }
      const parsed = parseWindowControlRequest(input);
      if (!parsed) {
        logger?.info("ipc.window-control", "Rejected window-control request.", {
          code: "malformed_request",
        });
        return { ok: false, code: "malformed_request" };
      }
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window || window.isDestroyed()) {
        logger?.info("ipc.window-control", "Rejected window-control request.", {
          code: "no_window",
        });
        return { ok: false, code: "no_window" };
      }
      return applyWindowControl(window, parsed.action);
    },
  );
}

/** Attach maximize/unmaximize push events for caption glyph sync. */
export function bindWindowMaximizedEvents(window: BrowserWindow): void {
  const push = (): void => {
    if (window.isDestroyed()) return;
    sendMaximizedState(window.webContents, window.isMaximized());
  };
  window.on("maximize", push);
  window.on("unmaximize", push);
}
