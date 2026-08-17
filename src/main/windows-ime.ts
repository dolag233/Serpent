/**
 * Windows IMM32 helpers for VIEWER-018.
 *
 * Chromium often swallows unmodified letter keys while a CJK IME is open, so
 * Renderer / even `before-input-event` never see D/F/X/C. Temporarily detaching
 * the IME from the focused HWND (ImmAssociateContext → NULL) and closing the
 * conversion UI (ImmSetOpenStatus(0)) lets letter shortcuts land as Latin —
 * the same pattern games and some native apps use while not typing.
 *
 * Call only from Main. No-ops on non-Windows or if koffi/imm32 fails to load.
 */

import type { BrowserWindow } from "electron";
import type * as Koffi from "koffi";

type ImmApi = {
  ImmGetContext: (hwnd: bigint | number) => bigint | number;
  ImmReleaseContext: (
    hwnd: bigint | number,
    himc: bigint | number,
  ) => number;
  ImmGetOpenStatus: (himc: bigint | number) => number;
  ImmSetOpenStatus: (himc: bigint | number, open: number) => number;
  ImmAssociateContext: (
    hwnd: bigint | number,
    himc: bigint | number,
  ) => bigint | number;
  GetFocus: () => bigint | number;
};

export type WindowsImeSuspendToken = {
  readonly hwnd: bigint;
  readonly previousHimc: bigint;
  readonly previousOpen: boolean | null;
};

let immApi: ImmApi | null | undefined;

function readHwnd(buffer: Buffer): bigint {
  if (buffer.length >= 8 && typeof buffer.readBigUInt64LE === "function") {
    return buffer.readBigUInt64LE(0);
  }
  return BigInt(buffer.readUInt32LE(0));
}

function asBigInt(value: bigint | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function loadImmApi(): ImmApi | null {
  if (immApi !== undefined) return immApi;
  if (process.platform !== "win32") {
    immApi = null;
    return null;
  }
  try {
    // Externalised in vite.main.config — resolved from node_modules at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi") as typeof Koffi;
    const imm32 = koffi.load("imm32.dll");
    const user32 = koffi.load("user32.dll");
    immApi = {
      ImmGetContext: imm32.func("uintptr_t ImmGetContext(uintptr_t hWnd)"),
      ImmReleaseContext: imm32.func(
        "int ImmReleaseContext(uintptr_t hWnd, uintptr_t hIMC)",
      ),
      ImmGetOpenStatus: imm32.func("int ImmGetOpenStatus(uintptr_t hIMC)"),
      ImmSetOpenStatus: imm32.func(
        "int ImmSetOpenStatus(uintptr_t hIMC, int fOpen)",
      ),
      ImmAssociateContext: imm32.func(
        "uintptr_t ImmAssociateContext(uintptr_t hWnd, uintptr_t hIMC)",
      ),
      GetFocus: user32.func("uintptr_t GetFocus()"),
    };
    return immApi;
  } catch {
    immApi = null;
    return null;
  }
}

/** Prefer the focused child HWND (Chromium), else the BrowserWindow HWND. */
export function resolveWindowsImeHwnd(
  window: BrowserWindow | null | undefined,
): bigint | null {
  const api = loadImmApi();
  if (!api || !window || window.isDestroyed()) return null;
  try {
    const focused = asBigInt(api.GetFocus());
    if (focused !== 0n) return focused;
  } catch {
    // fall through to top-level handle
  }
  try {
    return readHwnd(window.getNativeWindowHandle());
  } catch {
    return null;
  }
}

/**
 * Suspend IME conversion for shortcut capture. Returns a token to restore, or
 * null when IMM32 is unavailable / already idle.
 */
export function suspendWindowsIme(
  window: BrowserWindow | null | undefined,
): WindowsImeSuspendToken | null {
  const api = loadImmApi();
  const hwnd = resolveWindowsImeHwnd(window);
  if (!api || hwnd === null) return null;

  let previousOpen: boolean | null = null;
  try {
    const himc = asBigInt(api.ImmGetContext(hwnd));
    if (himc !== 0n) {
      try {
        previousOpen = api.ImmGetOpenStatus(himc) !== 0;
        if (previousOpen) {
          api.ImmSetOpenStatus(himc, 0);
        }
      } finally {
        api.ImmReleaseContext(hwnd, himc);
      }
    }
  } catch {
    previousOpen = null;
  }

  let previousHimc: bigint;
  try {
    // NULL HIMC detaches IME from this HWND so letter keys are not composed.
    previousHimc = asBigInt(api.ImmAssociateContext(hwnd, 0n));
  } catch {
    return previousOpen === null
      ? null
      : { hwnd, previousHimc: 0n, previousOpen };
  }

  return { hwnd, previousHimc, previousOpen };
}

/** Restore IME association / open status after video-viewer shortcut capture. */
export function restoreWindowsIme(token: WindowsImeSuspendToken | null): void {
  if (!token) return;
  const api = loadImmApi();
  if (!api) return;

  try {
    api.ImmAssociateContext(token.hwnd, token.previousHimc);
  } catch {
    // ignore — window may already be gone
  }

  if (token.previousOpen === null) return;
  try {
    const himc = asBigInt(api.ImmGetContext(token.hwnd));
    if (himc === 0n) return;
    try {
      api.ImmSetOpenStatus(himc, token.previousOpen ? 1 : 0);
    } finally {
      api.ImmReleaseContext(token.hwnd, himc);
    }
  } catch {
    // ignore
  }
}

/** Test seam: clear cached FFI bindings. */
export function resetWindowsImeForTests(): void {
  immApi = undefined;
}
