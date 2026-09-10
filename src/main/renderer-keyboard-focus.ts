/**
 * Reattach Chromium keyboard to the main window after async UI.
 *
 * On Windows, a native modal can return with BrowserWindow / webContents
 * already `isFocused()` while `document.hasFocus()` stays false. Focusing
 * the top-level HWND parks keys on the frameless shell. Steal must
 * `SetFocus` `Chrome_RenderWidgetHostHWND`. If the window already thinks it
 * is focused, blur first so Chromium actually receives WM_ACTIVATE — the
 * same reason Alt-Tab recovers typing.
 */

import { app } from "electron";

import { stealWindowsForeground } from "./windows-foreground";

export type RendererKeyboardFocusLogger = {
  info: (
    scope: string,
    message: string,
    context?: Record<string, unknown>,
  ) => void;
};

export type RendererKeyboardFocusWindow = {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  isFocused(): boolean;
  restore(): void;
  show?(): void;
  moveTop?(): void;
  blur?(): void;
  focus(): void;
  getNativeWindowHandle?(): Buffer;
  webContents: {
    focus(): void;
    isFocused?(): boolean;
    executeJavaScript?(
      code: string,
    ): Promise<unknown>;
  };
};

type KeyboardFocusLogger = RendererKeyboardFocusLogger | undefined;

let focusLogger: KeyboardFocusLogger;

export function bindRendererKeyboardFocusLogger(
  logger: KeyboardFocusLogger,
): void {
  focusLogger = logger;
}

function defaultStealAppFocus(): void {
  try {
    app.focus({ steal: true });
  } catch {
    // unit tests / app not ready
  }
}

function applyFocus(
  window: RendererKeyboardFocusWindow,
  options?: {
    readonly stealAppFocus?: () => void;
    readonly stealNativeForeground?: (
      target: RendererKeyboardFocusWindow,
    ) => boolean;
    readonly reason?: string;
  },
): void {
  (options?.stealAppFocus ?? defaultStealAppFocus)();
  let stolen: boolean;
  let renderWidgetFound: boolean | null = null;
  let focusedClass: string | null = null;
  if (options?.stealNativeForeground) {
    stolen = options.stealNativeForeground(window);
  } else {
    const result = stealWindowsForeground(window);
    stolen = result.ok;
    renderWidgetFound = result.renderWidgetFound;
    focusedClass = result.focusedClass;
  }
  window.show?.();
  window.moveTop?.();
  window.focus();
  window.webContents.focus();
  focusLogger?.info(
    "renderer.keyboard-focus",
    "Restored renderer keyboard focus.",
    {
      reason: options?.reason ?? "focus",
      windowFocused: window.isFocused(),
      webContentsFocused: window.webContents.isFocused?.() ?? null,
      stolenForeground: stolen,
      renderWidgetFound,
      focusedClass,
    },
  );
  const executeJavaScript = window.webContents.executeJavaScript;
  if (executeJavaScript) {
    void executeJavaScript("document.hasFocus()").then((documentHasFocus) => {
      if (typeof documentHasFocus !== "boolean") return;
      focusLogger?.info(
        "renderer.keyboard-focus",
        "Renderer document focus after steal.",
        {
          reason: options?.reason ?? "focus",
          documentHasFocus,
        },
      );
    }).catch(() => {
      // page may not be ready
    });
  }
}

export function ensureRendererKeyboardFocus(
  window: RendererKeyboardFocusWindow | null | undefined,
  options?: {
    readonly platform?: NodeJS.Platform;
    readonly schedule?: (callback: () => void) => void;
    /** After a native OS modal: blur if already focused, then steal again. */
    readonly reattachHwnd?: boolean;
    readonly stealAppFocus?: () => void;
    readonly stealNativeForeground?: (
      target: RendererKeyboardFocusWindow,
    ) => boolean;
    readonly reason?: string;
  },
): boolean {
  if (!window || window.isDestroyed()) return false;
  if (window.isMinimized()) window.restore();
  const platform = options?.platform ?? process.platform;
  const reattachHwnd = options?.reattachHwnd === true && platform === "win32";
  if (!reattachHwnd) {
    applyFocus(window, options);
    return true;
  }
  const schedule =
    options?.schedule ??
    ((callback) => {
      setTimeout(callback, 50);
    });
  // Already-focused frameless windows do not get WM_ACTIVATE from
  // SetForegroundWindow. Blur first so the later pass matches Alt-Tab.
  if (window.isFocused()) window.blur?.();
  schedule(() => {
    if (window.isDestroyed()) return;
    applyFocus(window, options);
  });
  return true;
}
