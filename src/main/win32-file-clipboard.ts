/**
 * Windows native CF_HDROP clipboard writer (Serpent 新工单4 / PureRef).
 *
 * Electron's `clipboard.writeBuffer('CF_HDROP', …)` registers a *custom*
 * format named "CF_HDROP" (RegisterClipboardFormat) instead of the predefined
 * CF_HDROP (ID 15) that Explorer/PureRef/Get-Clipboard -Format FileDropList
 * read — assets copied from Serpent were invisible to external apps. This
 * module calls the Win32 clipboard API directly via koffi (pure NAPI, no
 * native build) so the standard CF_HDROP + CF_UNICODETEXT payloads land on
 * the real formats, matching what Explorer writes when you copy files.
 */

import koffi from 'koffi';

import { buildCfHdrop } from './file-clipboard';

const CF_HDROP = 15;
const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

type User32Lib = {
  OpenClipboard(owner: unknown): boolean;
  EmptyClipboard(): boolean;
  SetClipboardData(format: number, handle: unknown): unknown;
  CloseClipboard(): boolean;
};

type Kernel32Lib = {
  GlobalAlloc(flags: number, bytes: number): unknown;
  GlobalLock(handle: unknown): unknown;
  GlobalUnlock(handle: unknown): boolean;
  GlobalFree(handle: unknown): unknown;
};

let user32: User32Lib | null = null;
let kernel32: Kernel32Lib | null = null;
let initialized = false;

function ensureLoaded(): boolean {
  if (initialized) return true;
  try {
    const loadedUser32 = koffi.load('user32.dll');
    const loadedKernel32 = koffi.load('kernel32.dll');
    // koffi 3.x: lib.func(prototype) 返回可调用函数（不挂到 lib 上）。
    user32 = {
      OpenClipboard: loadedUser32.func('bool OpenClipboard(void*)'),
      EmptyClipboard: loadedUser32.func('bool EmptyClipboard()'),
      SetClipboardData: loadedUser32.func('void* SetClipboardData(uint32, void*)'),
      CloseClipboard: loadedUser32.func('bool CloseClipboard()'),
    } as unknown as User32Lib;
    kernel32 = {
      GlobalAlloc: loadedKernel32.func('void* GlobalAlloc(uint32, size_t)'),
      GlobalLock: loadedKernel32.func('void* GlobalLock(void*)'),
      GlobalUnlock: loadedKernel32.func('bool GlobalUnlock(void*)'),
      GlobalFree: loadedKernel32.func('void* GlobalFree(void*)'),
    } as unknown as Kernel32Lib;
    initialized = true;
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy the payload into a moveable global memory block and hand it to the
 * clipboard. Ownership transfers to the system on success; on failure the
 * block is freed here.
 */
function writeClipboardFormat(
  formatId: number,
  data: Buffer,
  user32Lib: User32Lib,
  kernel32Lib: Kernel32Lib,
): boolean {
  const handle = kernel32Lib.GlobalAlloc(GMEM_MOVEABLE, data.length);
  if (!handle) return false;
  const pointer = kernel32Lib.GlobalLock(handle);
  if (!pointer) {
    kernel32Lib.GlobalFree(handle);
    return false;
  }
  try {
    // koffi.encode(ptr, type, value) 写入指针内存（decode 返回拷贝，不能写）。
    koffi.encode(
      pointer as never,
      koffi.array('uint8', data.length),
      data,
    );
  } finally {
    kernel32Lib.GlobalUnlock(handle);
  }
  if (!user32Lib.SetClipboardData(formatId, handle)) {
    kernel32Lib.GlobalFree(handle);
    return false;
  }
  return true;
}

/**
 * Write the given absolute file paths to the system clipboard as a standard
 * CF_HDROP (plus CF_UNICODETEXT for path text). Returns false when the Win32
 * clipboard is unavailable (non-Windows, load failure, clipboard busy) so
 * callers can fall back to the Electron buffer path.
 */
export function writeWin32FileClipboard(filePaths: readonly string[]): boolean {
  if (!ensureLoaded() || !user32 || !kernel32 || filePaths.length === 0) {
    return false;
  }
  try {
    if (!user32.OpenClipboard(null)) return false;
    if (!user32.EmptyClipboard()) {
      user32.CloseClipboard();
      return false;
    }
    let ok = true;
    try {
      ok = writeClipboardFormat(CF_HDROP, buildCfHdrop(filePaths), user32, kernel32);
      if (ok) {
        // Best-effort companion format so paste-into-text targets see paths.
        const text = Buffer.from(`${filePaths.join('\n')}\0`, 'utf16le');
        writeClipboardFormat(CF_UNICODETEXT, text, user32, kernel32);
      }
    } finally {
      user32.CloseClipboard();
    }
    return ok;
  } catch {
    try {
      user32.CloseClipboard();
    } catch {
      // Clipboard already closed.
    }
    return false;
  }
}
