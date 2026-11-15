// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LocaleProvider } from "../../src/renderer/i18n";
import { useInspectorAssetMetadata } from "../../src/renderer/use-inspector-asset-metadata";
import { useInspectorMultiEdit } from "../../src/renderer/use-inspector-multi-edit";
import { assetMetadataResultSchema } from "../../src/shared/asset-types";
import type { SerpentLibraryApi } from "../../src/shared/library-api";

it("silences successful rating saves while retaining other saves, failures and batch skips", async () => {
  const root = createRoot(document.createElement("div"));
  const metadata = assetMetadataResultSchema.parse({
    assetId: "one", description: null, rating: 0, favorite: false, palette: null,
    sourcePageUrl: null, author: null, entityVersion: 0, updatedAt: "2026-01-01T00:00:00Z",
  });
  const write = vi.fn(async () => ({ ok: true, value: { ...metadata, rating: 4, entityVersion: 1 } }));
  const batchWrite = vi.fn(async () => ({ ok: true, value: { skipped: [] } }));
  const api = {
    getAssetMetadata: vi.fn(async () => ({ ok: true, value: metadata })),
    getAiContent: vi.fn(async () => ({ ok: true, value: { tags: [] } })),
    setAssetMetadata: write, setAssetsRating: batchWrite,
  } as unknown as SerpentLibraryApi;
  const shared = {
    api, library: { libraryId: "library", displayPath: "fixture", displayName: "Fixture" },
    selectedAssetIdRef: { current: "one" },
    metadataByAssetRef: { current: new Map([["one", metadata]]) },
    metadataConflictAssetIdsRef: { current: new Set<string>() },
    setEditDescription: vi.fn(), setEditRating: vi.fn(), setEditFavorite: vi.fn(),
    setEditSourceUrl: vi.fn(), setEditAuthor: vi.fn(), setAssetMetadata: vi.fn(),
    setAssets: vi.fn(), setTrashedAssets: vi.fn(), setNotice: vi.fn(), setError: vi.fn(),
  };
  let single: ReturnType<typeof useInspectorAssetMetadata>;
  let multi: ReturnType<typeof useInspectorMultiEdit>;
  function Harness() {
    single = useInspectorAssetMetadata({ ...shared, selectedAssetId: "one",
      selectedAssetIdsRef: { current: ["one"] }, assetMetadata: metadata,
      aiContentRef: { current: null }, setAiContent: vi.fn(), setDescriptionIsAi: vi.fn(),
      setVersionConflict: vi.fn(),
    });
    multi = useInspectorMultiEdit({ ...shared, selectedAssetIds: ["one"] });
    return null;
  }
  try {
    await act(() => root.render(createElement(LocaleProvider, null, createElement(Harness))));
    await act(() => single.saveMetadata({ rating: 4 }));
    await act(() => single.saveMetadata({ rating: 0 }));
    await act(() => multi.batchSetRatingForSelection(4, ["one"]));
    expect(shared.setNotice).not.toHaveBeenCalled();
    expect(shared.setAssetMetadata).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
    await act(() => single.saveMetadata({ author: "Example author" }));
    expect(shared.setNotice).toHaveBeenCalledTimes(1);
    shared.setNotice.mockClear();
    write.mockRejectedValueOnce(new Error("Save failed"));
    await act(() => single.saveMetadata({ rating: 1 }));
    expect(shared.setError).toHaveBeenCalledWith(expect.stringContaining("Save failed"));
    batchWrite.mockRejectedValueOnce(new Error("Batch failed"));
    await act(() => multi.batchSetRatingForSelection(1, ["one"]));
    expect(shared.setError).toHaveBeenCalledWith(expect.stringContaining("Batch failed"));
    batchWrite.mockResolvedValueOnce({ ok: true, value: {
      skipped: [{ assetId: "one", reason: "NOT_FOUND" }],
    } } as never);
    await act(() => multi.batchSetRatingForSelection(1, ["one"]));
    expect(shared.setNotice).toHaveBeenCalledTimes(1);
  } finally { await act(() => root.unmount()); }
});
