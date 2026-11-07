import { describe, expect, it, vi } from "vitest";

import { loadRendererDevUrl } from "../../src/main/dev-renderer-load";

const url = "http://localhost:5173";

describe("development Renderer loading", () => {
  it("keeps one navigation alive while a cold module graph takes over 20 seconds", async () => {
    let now = 0;
    let mountChecks = 0;
    const loadURL = vi.fn(async () => undefined);
    const onNavigated = vi.fn();
    const window = {
      loadURL,
      webContents: {
        executeJavaScript: vi.fn(async (code: string) =>
          code.startsWith("import(") ? undefined : ++mountChecks >= 5),
      },
    };

    await loadRendererDevUrl(window, url, undefined, {
      now: () => now,
      sleep: async (ms) => { now += ms; },
      pollMs: 10_000,
      fetchUrl: async () => ({ ok: true }),
      onNavigated,
    });

    expect(now).toBe(40_000);
    expect(loadURL).toHaveBeenCalledExactlyOnceWith(url);
    expect(onNavigated).toHaveBeenCalledTimes(1);
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith("import('/src/renderer/main.tsx').then(() => true)");
  });

  it("retries a failed navigation, but never reloads a successfully loaded blank page", async () => {
    let now = 0;
    const loadURL = vi.fn()
      .mockRejectedValueOnce(new Error("navigation failed"))
      .mockResolvedValue(undefined);
    const window = {
      loadURL,
      webContents: {
        executeJavaScript: vi.fn(async (code: string) =>
          code.includes("root.childElementCount") ? "document=complete, root=0, viteError=false" : false),
      },
    };

    await expect(loadRendererDevUrl(window, url, undefined, {
      now: () => now,
      sleep: async (ms) => { now += ms; },
      pollMs: 10_000,
      mountWaitMs: 30_000,
      fetchUrl: async () => ({ ok: true }),
    })).rejects.toThrow("root=0");

    expect(loadURL).toHaveBeenCalledTimes(2);
    expect(now).toBe(30_400);
    expect(window.webContents.executeJavaScript.mock.calls.filter(([code]) =>
      code === "import('/src/renderer/main.tsx').then(() => true)")).toHaveLength(1);
  });

  it("reports an unreachable dev server without retrying a page that never loaded", async () => {
    let now = 0;
    const loadURL = vi.fn(async () => undefined);
    await expect(loadRendererDevUrl({
      loadURL,
      webContents: { executeJavaScript: vi.fn(async () => false) },
    }, url, undefined, {
      now: () => now,
      sleep: async (ms) => { now += ms; },
      serverWaitMs: 30_000,
      pollMs: 10_000,
      fetchUrl: async () => ({ ok: false }),
    })).rejects.toThrow("dev server did not become reachable");
    expect(loadURL).not.toHaveBeenCalled();
    expect(now).toBe(30_000);
  });
});
