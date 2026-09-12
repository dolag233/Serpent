import { describe, expect, it } from "vitest";

import { translateForLocale } from "../../src/renderer/i18n";
import { presentWorkspaceTab } from "../../src/renderer/workspace-tab-presentation";
import { createWorkspaceTabs } from "../../src/renderer/workspace-tabs";

describe("workspace tab presentation", () => {
  it("keeps a cached viewer title after another tab replaces the shared asset list", () => {
    const state = createWorkspaceTabs(() => "viewer-tab");
    const tab = state.tabs[0]!;
    tab.history.push({ kind: "preview", assetId: "asset-1" });
    tab.cachedTitle = "Reference board.png";

    expect(presentWorkspaceTab(tab, {
      folders: [],
      linkedFolders: [],
      collections: [],
      smartCollections: [],
      tags: [],
      assets: [],
      pluginViews: [],
      t: (key, params) => translateForLocale("en", key, params),
    })).toMatchObject({
      title: "Reference board.png",
      icon: "file",
      entity: null,
    });
  });

  it("exposes folder and collection identities only for their contextual menus", () => {
    const state = createWorkspaceTabs(() => "folder-tab");
    const tab = state.tabs[0]!;
    tab.history.push({ kind: "folder", folderId: "folder-1" });
    const common = {
      folders: [{
        folderId: "folder-1",
        parentFolderId: null,
        name: "Characters",
        relativePath: "Characters",
        directAssetCount: 2,
        childFolderCount: 0,
      }],
      linkedFolders: [],
      collections: [],
      smartCollections: [],
      tags: [],
      assets: [],
      pluginViews: [],
      t: (key: Parameters<typeof translateForLocale>[1], params?: Record<string, string | number>) =>
        translateForLocale("en", key, params),
    };

    expect(presentWorkspaceTab(tab, common)).toMatchObject({
      title: "Characters",
      entity: { kind: "folder", id: "folder-1", name: "Characters" },
    });
  });
});
