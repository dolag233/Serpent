import { describe, expect, it } from "vitest";
import {
  resolveAssetSourceBadgeLabel,
  shouldShowAssetSourceBadge,
} from "../../src/renderer/asset-source-badge";

const folders = [
  {
    folderId: "parent",
    name: "设计",
    relativePath: "设计",
  },
  {
    folderId: "child-a",
    name: "素材",
    relativePath: "设计/素材",
  },
  {
    folderId: "child-b",
    name: "角色",
    relativePath: "设计/插画/角色",
  },
];

describe("shouldShowAssetSourceBadge", () => {
  it("shows child-folder assets under recursive folder scope", () => {
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "parent",
          mixedFolderBrowse: false,
        },
        "child-a",
      ),
    ).toBe(true);
  });

  it("hides badges for assets native to the current folder", () => {
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "parent",
          mixedFolderBrowse: false,
        },
        "parent",
      ),
    ).toBe(false);
  });

  it("still shows when folderId differs even if recursive is off", () => {
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "parent",
          mixedFolderBrowse: false,
        },
        "child-a",
      ),
    ).toBe(true);
  });

  it("shows folder chips in all-assets for folder-owned assets only", () => {
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "all",
          mixedFolderBrowse: false,
        },
        "child-a",
      ),
    ).toBe(true);
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "all",
          mixedFolderBrowse: false,
        },
        null,
      ),
    ).toBe(false);
  });

  it("shows folder chips on mixed browse surfaces", () => {
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "root",
          mixedFolderBrowse: true,
        },
        "child-a",
      ),
    ).toBe(true);
  });

  it("hides chips for pure library-root browse", () => {
    expect(
      shouldShowAssetSourceBadge(
        {
          assetScope: "root",
          mixedFolderBrowse: false,
        },
        null,
      ),
    ).toBe(false);
  });
});

describe("resolveAssetSourceBadgeLabel", () => {
  it("uses path relative to the current folder when nested", () => {
    expect(
      resolveAssetSourceBadgeLabel(folders, "child-b", "parent"),
    ).toBe("插画/角色");
    expect(
      resolveAssetSourceBadgeLabel(folders, "child-a", "parent"),
    ).toBe("素材");
  });

  it("falls back to library-relative path outside a folder scope", () => {
    expect(resolveAssetSourceBadgeLabel(folders, "child-a", null)).toBe(
      "设计/素材",
    );
  });

  it("returns null for unknown or root assets", () => {
    expect(resolveAssetSourceBadgeLabel(folders, null, "parent")).toBeNull();
    expect(
      resolveAssetSourceBadgeLabel(folders, "missing", "parent"),
    ).toBeNull();
  });
});
