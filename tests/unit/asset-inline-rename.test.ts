import { describe, expect, it } from "vitest";

import {
  resolveAssetRenameCommit,
  splitAssetFileName,
  type AssetRenameDialogState,
} from "../../src/renderer/useAssetRename";

function renameSession(
  overrides: Partial<AssetRenameDialogState> = {},
): AssetRenameDialogState {
  return {
    assetId: "asset-1",
    extension: ".png",
    originalFileName: "hero.png",
    originalBaseName: "hero",
    value: "hero.png",
    error: null,
    submitting: false,
    ...overrides,
  };
}

describe("splitAssetFileName", () => {
  it("keeps a leading-dot name as base with no extension", () => {
    expect(splitAssetFileName(".gitkeep")).toEqual({
      baseName: ".gitkeep",
      extension: "",
    });
  });

  it("splits the final extension the same way as path.posix.extname", () => {
    expect(splitAssetFileName("hero.png")).toEqual({
      baseName: "hero",
      extension: ".png",
    });
    expect(splitAssetFileName("archive.tar.gz")).toEqual({
      baseName: "archive.tar",
      extension: ".gz",
    });
  });
});

describe("resolveAssetRenameCommit", () => {
  it("cancels a blank basename instead of submitting", () => {
    expect(
      resolveAssetRenameCommit(renameSession({ value: "   " })),
    ).toEqual({ action: "cancel" });
  });

  it("treats re-committing the original basename as a no-op cancel", () => {
    expect(
      resolveAssetRenameCommit(renameSession({ value: "  hero.png  " })),
    ).toEqual({ action: "cancel" });
  });

  it("submits a changed trimmed basename", () => {
    expect(
      resolveAssetRenameCommit(renameSession({ value: " hero-renamed.png " })),
    ).toEqual({ action: "submit", newFileName: "hero-renamed.png" });
  });

  it("keeps editing when a request is already in flight", () => {
    expect(
      resolveAssetRenameCommit(renameSession({ submitting: true, value: "x" })),
    ).toEqual({ action: "keep-editing" });
  });
});
