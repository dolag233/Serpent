import { describe, expect, it } from "vitest";

import type { AssetSummary } from "../../src/shared/asset-types";
import {
  canRenameAssetWithShortcut,
  planAssetDeleteShortcut,
} from "../../src/renderer/browse-key-command";

function asset(
  partial: Pick<AssetSummary, "assetId"> & Partial<AssetSummary>,
): AssetSummary {
  return {
    locationKind: "managed",
    managedFolderId: null,
    relativeFilePath: `${partial.assetId}.jpg`,
    displayName: `${partial.assetId}.jpg`,
    currentRevisionId: `rev-${partial.assetId}`,
    byteSize: 1,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    availability: "available",
    rating: 0,
    favorite: false,
    deletedAt: null,
    trashedFromPath: null,
    trashedFromTombstoneId: null,
    remainingDays: null,
    thumbnailStatus: "ready",
    thumbnailArtifactId: null,
    mediaType: "image",
    width: 100,
    height: 100,
    durationMs: null,
    ...partial,
  };
}

describe("browse-key-command (Serpent-g8u9)", () => {
  it("renames linked assets the same as managed", () => {
    expect(
      canRenameAssetWithShortcut(
        asset({ assetId: "l", locationKind: "linked" }),
      ),
    ).toBe(true);
    expect(
      canRenameAssetWithShortcut(
        asset({ assetId: "m", locationKind: "managed" }),
      ),
    ).toBe(true);
    expect(
      canRenameAssetWithShortcut(
        asset({ assetId: "gone", availability: "missing" }),
      ),
    ).toBe(false);
  });

  it("Delete on linked assets trashes source files with no confirmation plan", () => {
    expect(
      planAssetDeleteShortcut({
        showTrash: false,
        activeCollectionId: null,
        libraryOpen: true,
        selectedAssets: [asset({ assetId: "l", locationKind: "linked" })],
      }),
    ).toEqual({ type: "trash-linked", assetIds: ["l"] });
  });

  it("Delete on managed assets still trashes to the app trash", () => {
    expect(
      planAssetDeleteShortcut({
        showTrash: false,
        activeCollectionId: null,
        libraryOpen: true,
        selectedAssets: [asset({ assetId: "m" })],
      }),
    ).toEqual({ type: "trash-managed", assetIds: ["m"] });
  });
});
