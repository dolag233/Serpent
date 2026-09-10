/**
 * Steal keyboard into Chromium's render widget after a native modal.
 *
 * Electron `BrowserWindow.focus()` can report focused while
 * `document.hasFocus()` stays false. The usual mistake is `SetFocus` on the
 * top-level `Chrome_WidgetWin_*` frame: Windows then delivers WM_CHAR to the
 * frameless shell, not `Chrome_RenderWidgetHostHWND`. Mouse still hits the
 * page; caret and keys do not. Alt-Tab works because it reactivates the
 * child widget.
 *
 * Call only from Main. No-ops off Windows or if koffi/user32 fails.
 */

import type { BrowserWindow } from "electron";
import type * as Koffi from "koffi";

export const CHROME_RENDER_WIDGET_CLASS = "Chrome_RenderWidgetHostHWND";

const GW_HWNDNEXT = 2;
const GW_CHILD = 5;
const ASFW_ANY = 0xffffffff;
const WM_SETFOCUS = 0x0007;
const WM_ACTIVATE = 0x0006;
const WA_CLICKACTIVE = 2;

export type WindowsForegroundApi = {
  AllowSetForegroundWindow: (processId: number) => number;
  GetForegroundWindow: () => bigint | number;
  GetFocus?: () => bigint | number;
  GetWindow?: (hwnd: bigint | number, cmd: number) => bigint | number;
  GetClassNameA?: (
    hwnd: bigint | number,
    buffer: Buffer,
    maxLength: number,
  ) => number;
  SendMessageW?: (
    hwnd: bigint | number,
    msg: number,
    wParam: bigint | number,
    lParam: bigint | number,
  ) => bigint | number;
  GetWindowThreadProcessId: (
    hwnd: bigint | number,
    processIdPtr: bigint | number,
  ) => number;
  GetCurrentThreadId: () => number;
  AttachThreadInput: (
    idAttach: number,
    idAttachTo: number,
    attach: number,
  ) => number;
  BringWindowToTop: (hwnd: bigint | number) => number;
  SetForegroundWindow: (hwnd: bigint | number) => number;
  SetFocus: (hwnd: bigint | number) => bigint | number;
};

export type WindowsForegroundWindow = {
  isDestroyed(): boolean;
  getNativeWindowHandle?(): Buffer;
};

export type StealWindowsForegroundResult = {
  readonly ok: boolean;
  readonly renderWidgetFound: boolean;
  readonly focusedClass: string | null;
};

let foregroundApi: WindowsForegroundApi | null | undefined;

function readHwnd(buffer: Buffer): bigint {
  if (buffer.length >= 8 && typeof buffer.readBigUInt64LE === "function") {
    return buffer.readBigUInt64LE(0);
  }
  return BigInt(buffer.readUInt32LE(0));
}

function asBigInt(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function loadForegroundApi(): WindowsForegroundApi | null {
  if (foregroundApi !== undefined) return foregroundApi;
  if (process.platform !== "win32") {
    foregroundApi = null;
    return null;
  }
  try {
    // Externalised in vite.main.config — resolved from node_modules at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi") as typeof Koffi;
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    foregroundApi = {
      AllowSetForegroundWindow: user32.func(
        "int AllowSetForegroundWindow(uint32_t dwProcessId)",
      ),
      GetForegroundWindow: user32.func("uintptr_t GetForegroundWindow()"),
      GetFocus: user32.func("uintptr_t GetFocus()"),
      GetWindow: user32.func("uintptr_t GetWindow(uintptr_t hWnd, uint32_t uCmd)"),
      GetClassNameA: user32.func(
        "int GetClassNameA(uintptr_t hWnd, uint8_t *lpClassName, int nMaxCount)",
      ),
      SendMessageW: user32.func(
        "intptr_t SendMessageW(uintptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)",
      ),
      GetWindowThreadProcessId: user32.func(
        "uint32_t GetWindowThreadProcessId(uintptr_t hWnd, uintptr_t lpdwProcessId)",
      ),
      GetCurrentThreadId: kernel32.func("uint32_t GetCurrentThreadId()"),
      AttachThreadInput: user32.func(
        "int AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int fAttach)",
      ),
      BringWindowToTop: user32.func("int BringWindowToTop(uintptr_t hWnd)"),
      SetForegroundWindow: user32.func(
        "int SetForegroundWindow(uintptr_t hWnd)",
      ),
      SetFocus: user32.func("uintptr_t SetFocus(uintptr_t hWnd)"),
    };
    return foregroundApi;
  } catch {
    foregroundApi = null;
    return null;
  }
}

export function readWindowClassName(
  hwnd: bigint,
  api: Pick<WindowsForegroundApi, "GetClassNameA">,
): string | null {
  if (!api.GetClassNameA || hwnd === 0n) return null;
  const buffer = Buffer.alloc(256);
  const length = api.GetClassNameA(hwnd, buffer, buffer.length - 1);
  if (length <= 0) return null;
  return buffer.toString("utf8", 0, length);
}

/** Depth-first: first `Chrome_RenderWidgetHostHWND` under the frame. */
export function findChromeRenderWidgetHwnd(
  root: bigint,
  api: Pick<WindowsForegroundApi, "GetWindow" | "GetClassNameA">,
): bigint | null {
  if (!api.GetWindow || !api.GetClassNameA || root === 0n) return null;
  const stack = [root];
  while (stack.length > 0) {
    const parent = stack.pop();
    if (parent === undefined) break;
    let child = asBigInt(api.GetWindow(parent, GW_CHILD));
    while (child !== 0n) {
      const className = readWindowClassName(child, api);
      if (className === CHROME_RENDER_WIDGET_CLASS) return child;
      stack.push(child);
      child = asBigInt(api.GetWindow(child, GW_HWNDNEXT));
    }
  }
  return null;
}

function attachToForeground(
  hwnd: bigint,
  api: WindowsForegroundApi,
): Array<[number, number]> {
  let foreground = 0n;
  try {
    foreground = asBigInt(api.GetForegroundWindow());
  } catch {
    foreground = 0n;
  }
  const ourThread = api.GetWindowThreadProcessId(hwnd, 0);
  const foregroundThread =
    foreground === 0n ? 0 : api.GetWindowThreadProcessId(foreground, 0);
  const currentThread = api.GetCurrentThreadId();
  const attached: Array<[number, number]> = [];
  const attach = (from: number, to: number): void => {
    if (from === 0 || to === 0 || from === to) return;
    if (api.AttachThreadInput(from, to, 1)) attached.push([from, to]);
  };
  attach(currentThread, foregroundThread);
  attach(ourThread, foregroundThread);
  attach(currentThread, ourThread);
  return attached;
}

function detachThreads(
  api: WindowsForegroundApi,
  attached: Array<[number, number]>,
): void {
  for (const [from, to] of attached) {
    try {
      api.AttachThreadInput(from, to, 0);
    } catch {
      // window may already be gone
    }
  }
}

/** Visible for tests: activate the frame, SetFocus the render widget only. */
export function stealWindowsForegroundWithApi(
  hwnd: bigint,
  api: WindowsForegroundApi,
  renderWidgetHwnd?: bigint | null,
): StealWindowsForegroundResult {
  if (hwnd === 0n) {
    return { ok: false, renderWidgetFound: false, focusedClass: null };
  }
  try {
    api.AllowSetForegroundWindow(ASFW_ANY);
  } catch {
    // optional — older Windows still accepts AttachThreadInput
  }

  const renderHwnd =
    renderWidgetHwnd === undefined
      ? findChromeRenderWidgetHwnd(hwnd, api)
      : renderWidgetHwnd;
  const attached = attachToForeground(hwnd, api);
  try {
    api.BringWindowToTop(hwnd);
    api.SetForegroundWindow(hwnd);
    // Never SetFocus the frame HWND: that parks keyboard on the frameless
    // shell and leaves document.hasFocus() false.
    if (renderHwnd !== null && renderHwnd !== 0n) {
      api.SetFocus(renderHwnd);
      try {
        api.SendMessageW?.(renderHwnd, WM_ACTIVATE, WA_CLICKACTIVE, 0);
        api.SendMessageW?.(renderHwnd, WM_SETFOCUS, 0, 0);
      } catch {
        // SendMessage is best-effort
      }
    }
    const focused = api.GetFocus ? asBigInt(api.GetFocus()) : 0n;
    return {
      ok: true,
      renderWidgetFound: renderHwnd !== null && renderHwnd !== 0n,
      focusedClass: focused === 0n ? null : readWindowClassName(focused, api),
    };
  } catch {
    return {
      ok: attached.length > 0,
      renderWidgetFound: renderHwnd !== null && renderHwnd !== 0n,
      focusedClass: null,
    };
  } finally {
    detachThreads(api, attached);
  }
}

export function stealWindowsForeground(
  window: WindowsForegroundWindow | BrowserWindow | null | undefined,
  api: WindowsForegroundApi | null = loadForegroundApi(),
): StealWindowsForegroundResult {
  if (!api || !window || window.isDestroyed()) {
    return { ok: false, renderWidgetFound: false, focusedClass: null };
  }
  if (typeof window.getNativeWindowHandle !== "function") {
    return { ok: false, renderWidgetFound: false, focusedClass: null };
  }
  let hwnd: bigint;
  try {
    hwnd = readHwnd(window.getNativeWindowHandle());
  } catch {
    return { ok: false, renderWidgetFound: false, focusedClass: null };
  }
  return stealWindowsForegroundWithApi(hwnd, api);
}
