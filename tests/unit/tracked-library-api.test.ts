import { describe, expect, it, vi } from "vitest";

import type { SerpentLibraryApi } from "../../src/shared/library-api";
import { createTrackedLibraryApi } from "../../src/renderer/tracked-library-api";

describe("createTrackedLibraryApi", () => {
  it("tracks mutating requests until their promise settles", async () => {
    const starts: string[] = [];
    const ends: string[] = [];
    const api = {
      trashAssets: vi.fn(async () => ({ ok: true, value: { trashedCount: 1 } })),
      listAssets: vi.fn(async () => ({ ok: true, value: [] })),
    } as unknown as SerpentLibraryApi;
    const tracked = createTrackedLibraryApi(
      api,
      () => starts.push("start"),
      () => ends.push("end"),
    );

    const result = await tracked.trashAssets({ libraryId: "library", assetIds: ["asset"] });
    await tracked.listAssets({ libraryId: "library", recursive: true });

    expect(result.ok).toBe(true);
    expect(starts).toEqual(["start"]);
    expect(ends).toEqual(["end"]);
    expect(api.trashAssets).toHaveBeenCalledTimes(1);
    expect(api.listAssets).toHaveBeenCalledTimes(1);
  });

  it("can wrap the frozen preload bridge without violating Proxy invariants", async () => {
    const onWriteStart = vi.fn();
    const onWriteEnd = vi.fn();
    const api = Object.freeze({
      trashAssets: async () => ({ ok: true, value: { trashedCount: 1 } }),
    }) as unknown as SerpentLibraryApi;
    const tracked = createTrackedLibraryApi(api, onWriteStart, onWriteEnd);

    await expect(
      tracked.trashAssets({ libraryId: "library", assetIds: ["asset"] }),
    ).resolves.toMatchObject({ ok: true });
    expect(onWriteStart).toHaveBeenCalledTimes(1);
    expect(onWriteEnd).toHaveBeenCalledTimes(1);
  });

  it("releases the write lease when a mutating request throws synchronously", () => {
    const onWriteStart = vi.fn();
    const onWriteEnd = vi.fn();
    const api = {
      trashAssets: () => {
        throw new Error("bridge unavailable");
      },
    } as unknown as SerpentLibraryApi;
    const tracked = createTrackedLibraryApi(api, onWriteStart, onWriteEnd);

    expect(() => tracked.trashAssets({ libraryId: "library", assetIds: [] })).toThrow(
      "bridge unavailable",
    );
    expect(onWriteStart).toHaveBeenCalledTimes(1);
    expect(onWriteEnd).toHaveBeenCalledTimes(1);
  });
});
