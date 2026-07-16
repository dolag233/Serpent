import { describe, expect, it } from "vitest";

import { buildScopeBreadcrumbSegments } from "../../src/renderer/ScopeBreadcrumbs";

describe("buildScopeBreadcrumbSegments", () => {
  it("omits a leading library prefix and shows all-assets", () => {
    expect(
      buildScopeBreadcrumbSegments({
        showTrash: false,
        activeTagLabel: null,
        activeCollectionLabel: null,
        activeSmartCollectionLabel: null,
        assetScope: "all",
        folderTrail: [],
      }),
    ).toEqual([{ kind: "static", id: "all", label: "所有资产" }]);
  });

  it("builds clickable managed folder crumbs", () => {
    expect(
      buildScopeBreadcrumbSegments({
        showTrash: false,
        activeTagLabel: null,
        activeCollectionLabel: null,
        activeSmartCollectionLabel: null,
        assetScope: "leaf",
        folderTrail: [
          { folderId: "root", name: "Root" },
          { folderId: "leaf", name: "Leaf" },
        ],
      }),
    ).toEqual([
      { kind: "folder", id: "root", label: "Root", folderId: "root" },
      { kind: "folder", id: "leaf", label: "Leaf", folderId: "leaf" },
    ]);
  });

  it("falls back to linked folder label when there is no managed trail", () => {
    expect(
      buildScopeBreadcrumbSegments({
        showTrash: false,
        activeTagLabel: null,
        activeCollectionLabel: null,
        activeSmartCollectionLabel: null,
        assetScope: "linked-1",
        folderTrail: [],
        linkedFolderLabel: "External shots",
      }),
    ).toEqual([
      { kind: "static", id: "linked-1", label: "External shots" },
    ]);
  });
});
