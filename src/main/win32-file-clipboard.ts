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

import { buildCfHdrop, parseCfHdrop } from './file-clipboard';

const CF_HDROP = 15;
const CF_UNICODETEXT = 13;
const GMEM_MOVEABLE = 0x0002;

type User32Lib = {
  OpenClipboard(owner: unknown): boolean;
  EmptyClipboard(): boolean;
  SetClipboardData(format: number, handle: unknown): unknown;
  CloseClipboard(): boolean;
  GetClipboardData(format: number): unknown;
  RegisterClipboardFormatW(name: string): number;
  GetClipboardSequenceNumber(): number;
};

type Kernel32Lib = {
  GlobalAlloc(flags: number, bytes: number): unknown;
  GlobalLock(handle: unknown): unknown;
  GlobalUnlock(handle: unknown): boolean;
  GlobalFree(handle: unknown): unknown;
  GlobalSize(handle: unknown): number;
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
      GetClipboardData: loadedUser32.func('void* GetClipboardData(uint32)'),
      RegisterClipboardFormatW: loadedUser32.func('uint32 RegisterClipboardFormatW(str16)'),
      GetClipboardSequenceNumber: loadedUser32.func('uint32 GetClipboardSequenceNumber()'),
    } as unknown as User32Lib;
    kernel32 = {
      GlobalAlloc: loadedKernel32.func('void* GlobalAlloc(uint32, size_t)'),
      GlobalLock: loadedKernel32.func('void* GlobalLock(void*)'),
      GlobalUnlock: loadedKernel32.func('bool GlobalUnlock(void*)'),
      GlobalFree: loadedKernel32.func('void* GlobalFree(void*)'),
      GlobalSize: loadedKernel32.func('size_t GlobalSize(void*)'),
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
export function writeWin32FileClipboard(filePaths: readonly string[], operation: 'copy' | 'cut' = 'copy'): boolean {
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
        const effect = Buffer.alloc(4);
        effect.writeUInt32LE(operation === 'cut' ? 2 : 1);
        ok = writeClipboardFormat(user32.RegisterClipboardFormatW('Preferred DropEffect'), effect, user32, kernel32);
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

/** Read the clipboard change token without opening or decoding its contents. */
export function readWin32ClipboardSequenceNumber(): number | null {
  if (process.platform !== 'win32' || !ensureLoaded() || !user32) return null;
  const sequence = user32.GetClipboardSequenceNumber();
  return sequence === 0 ? null : sequence;
}

/** Read predefined CF_HDROP, rather than a registered format with that name. */
export function readWin32FileClipboard(): { paths: string[]; operation: 'copy' | 'cut'; sequence: number } | null {
  if (process.platform !== 'win32' || !ensureLoaded() || !user32 || !kernel32) return null;
  const user = user32;
  const kernel = kernel32;
  if (!user.OpenClipboard(null)) return null;
  try {
    const read = (format: number): Buffer | null => {
      const handle = user.GetClipboardData(format);
      if (!handle) return null;
      const size = kernel.GlobalSize(handle);
      if (size <= 0 || size > 16 * 1024 * 1024) return null;
      const pointer = kernel.GlobalLock(handle);
      if (!pointer) return null;
      try {
        return Buffer.from(koffi.decode(pointer as never, koffi.array('uint8', size)) as number[]);
      } finally {
        kernel.GlobalUnlock(handle);
      }
    };
    const drop = read(CF_HDROP) ?? read(user.RegisterClipboardFormatW('CF_HDROP'));
    const singlePath = drop ? null : read(user.RegisterClipboardFormatW('FileNameW'));
    const effect = read(user.RegisterClipboardFormatW('Preferred DropEffect'));
    return {
      paths: drop ? parseCfHdrop(drop) : singlePath ? [singlePath.toString('utf16le').replace(/\0+$/, '')].filter(Boolean) : [],
      operation: effect && effect.length >= 4 && (effect.readUInt32LE(0) & 2) !== 0 ? 'cut' : 'copy',
      sequence: user.GetClipboardSequenceNumber(),
    };
  } catch {
    return null;
  } finally {
    user.CloseClipboard();
  }
}
