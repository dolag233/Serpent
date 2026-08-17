import { describe, expect, it } from "vitest";

import { resolveExtensionActiveContextTarget } from "../../src/renderer/extension-active-context";

describe("resolveExtensionActiveContextTarget", () => {
  it("clears context when no library is open", () => {
    expect(
      resolveExtensionActiveContextTarget({
        libraryId: null,
        showTrash: false,
        activeTagId: null,
        activeCollectionId: null,
        activeSmartCollectionId: null,
        assetScope: "all",
      }),
    ).toEqual({ libraryId: null });
  });

  it("publishes the managed folder while browsing a folder scope", () => {
    expect(
      resolveExtensionActiveContextTarget({
        libraryId: "lib-1",
        showTrash: false,
        activeTagId: null,
        activeCollectionId: null,
        activeSmartCollectionId: null,
        assetScope: "folder-1",
      }),
    ).toEqual({ libraryId: "lib-1", selectedFolderId: "folder-1" });
  });

  it("falls back to library root for trash and virtual scopes", () => {
    expect(
      resolveExtensionActiveContextTarget({
        libraryId: "lib-1",
        showTrash: true,
        activeTagId: null,
        activeCollectionId: null,
        activeSmartCollectionId: null,
        assetScope: "folder-1",
      }),
    ).toEqual({ libraryId: "lib-1" });
  });
});
