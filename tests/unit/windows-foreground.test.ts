import { describe, expect, it, vi } from "vitest";

import {
  CHROME_RENDER_WIDGET_CLASS,
  findChromeRenderWidgetHwnd,
  stealWindowsForegroundWithApi,
  type WindowsForegroundApi,
} from "../../src/main/windows-foreground";

function writeClassName(buffer: Buffer, name: string): number {
  buffer.fill(0);
  buffer.write(name, "utf8");
  return name.length;
}

describe("findChromeRenderWidgetHwnd", () => {
  it("walks child windows until Chrome_RenderWidgetHostHWND", () => {
    const classNames: Record<string, string> = {
      "2": "Intermediate D3D Window",
      "3": CHROME_RENDER_WIDGET_CLASS,
    };
    const api = {
      GetWindow: vi.fn((hwnd: bigint | number, cmd: number) => {
        const id = typeof hwnd === "bigint" ? hwnd : BigInt(hwnd);
        if (cmd === 5) {
          if (id === 1n) return 2n;
          return 0n;
        }
        if (cmd === 2 && id === 2n) return 3n;
        return 0n;
      }),
      GetClassNameA: vi.fn(
        (hwnd: bigint | number, buffer: Buffer) => {
          const id = String(typeof hwnd === "bigint" ? hwnd : BigInt(hwnd));
          return writeClassName(buffer, classNames[id] ?? "Other");
        },
      ),
    };

    expect(findChromeRenderWidgetHwnd(1n, api)).toBe(3n);
  });
});

describe("stealWindowsForegroundWithApi", () => {
  it("attaches to the foreign foreground thread then activates the frame", () => {
    const attached: Array<[number, number, number]> = [];
    const api: WindowsForegroundApi = {
      AllowSetForegroundWindow: vi.fn(() => 1),
      GetForegroundWindow: vi.fn(() => 99n),
      GetWindowThreadProcessId: vi.fn((hwnd: bigint | number) =>
        hwnd === 42n ? 7 : 3,
      ),
      GetCurrentThreadId: vi.fn(() => 11),
      AttachThreadInput: vi.fn(
        (from: number, to: number, attach: number) => {
          attached.push([from, to, attach]);
          return 1;
        },
      ),
      BringWindowToTop: vi.fn(() => 1),
      SetForegroundWindow: vi.fn(() => 1),
      SetFocus: vi.fn(() => 7n),
    };

    expect(stealWindowsForegroundWithApi(42n, api).ok).toBe(true);
    expect(api.AllowSetForegroundWindow).toHaveBeenCalledWith(0xffffffff);
    expect(api.SetForegroundWindow).toHaveBeenCalledWith(42n);
    expect(api.SetFocus).not.toHaveBeenCalled();
    expect(attached.filter((entry) => entry[2] === 1)).toEqual([
      [11, 3, 1],
      [7, 3, 1],
      [11, 7, 1],
    ]);
    expect(attached.filter((entry) => entry[2] === 0)).toHaveLength(3);
  });

  it("SetFocus the render widget, never the frame HWND", () => {
    const api: WindowsForegroundApi = {
      AllowSetForegroundWindow: vi.fn(() => 1),
      GetForegroundWindow: vi.fn(() => 42n),
      GetFocus: vi.fn(() => 7n),
      GetWindowThreadProcessId: vi.fn(() => 7),
      GetCurrentThreadId: vi.fn(() => 7),
      AttachThreadInput: vi.fn(() => 1),
      BringWindowToTop: vi.fn(() => 1),
      SetForegroundWindow: vi.fn(() => 1),
      SetFocus: vi.fn(() => 7n),
      SendMessageW: vi.fn(() => 0n),
      GetClassNameA: vi.fn((hwnd, buffer) =>
        writeClassName(
          buffer,
          hwnd === 7n ? CHROME_RENDER_WIDGET_CLASS : "Chrome_WidgetWin_1",
        ),
      ),
    };

    const result = stealWindowsForegroundWithApi(42n, api, 7n);
    expect(result).toEqual({
      ok: true,
      renderWidgetFound: true,
      focusedClass: CHROME_RENDER_WIDGET_CLASS,
    });
    expect(api.SetFocus).toHaveBeenCalledWith(7n);
    expect(api.SetFocus).not.toHaveBeenCalledWith(42n);
    expect(api.AttachThreadInput).not.toHaveBeenCalled();
  });
});
