import { describe, expect, it } from "vitest";
import {
  isAllAssetsNavActive,
  isManagedFolderNavActive,
  isRootFolderNavActive,
  isTagManagementNavActive,
  isTrashNavActive,
} from "../../src/renderer/browse-nav-active";

const base = {
  assetScope: "all" as const,
  showTrash: false,
  showTagManagement: false,
  activeTagId: null,
  activeCollectionId: null,
  activeSmartCollectionId: null,
};

describe("browse-nav-active", () => {
  it("marks all-assets only when no other browse mode is active", () => {
    expect(isAllAssetsNavActive(base)).toBe(true);
    expect(
      isAllAssetsNavActive({ ...base, activeSmartCollectionId: "sc-1" }),
    ).toBe(false);
    expect(isAllAssetsNavActive({ ...base, activeCollectionId: "c-1" })).toBe(
      false,
    );
    expect(isAllAssetsNavActive({ ...base, showTrash: true })).toBe(false);
    expect(
      isAllAssetsNavActive({ ...base, showTagManagement: true }),
    ).toBe(false);
  });

  it("keeps trash / root / folder exclusive of smart collections", () => {
    expect(isTrashNavActive({ ...base, showTrash: true })).toBe(true);
    expect(
      isTrashNavActive({
        ...base,
        showTrash: true,
        activeSmartCollectionId: "sc-1",
      }),
    ).toBe(false);
    expect(isRootFolderNavActive({ ...base, assetScope: "root" })).toBe(true);
    expect(
      isRootFolderNavActive({
        ...base,
        assetScope: "root",
        activeSmartCollectionId: "sc-1",
      }),
    ).toBe(false);
    expect(isManagedFolderNavActive(base, "f-1")).toBe(false);
    expect(
      isManagedFolderNavActive({ ...base, assetScope: "f-1" }, "f-1"),
    ).toBe(true);
    expect(
      isManagedFolderNavActive(
        { ...base, assetScope: "f-1", activeSmartCollectionId: "sc-1" },
        "f-1",
      ),
    ).toBe(false);
  });

  it("marks tag management exclusively", () => {
    expect(isTagManagementNavActive({ ...base, showTagManagement: true })).toBe(
      true,
    );
    expect(
      isTrashNavActive({ ...base, showTrash: true, showTagManagement: true }),
    ).toBe(false);
    expect(
      isRootFolderNavActive({
        ...base,
        assetScope: "root",
        showTagManagement: true,
      }),
    ).toBe(false);
  });
});
