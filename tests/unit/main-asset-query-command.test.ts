import { expect, test } from "vitest";

import { executeAssetQueryMainCommand } from "../../src/main/commands/asset-query";

test("asset.list omits empty assetIds", () => {
  expect(executeAssetQueryMainCommand({
    type: "asset.list.request",
    libraryId: "lib-1",
    folderId: "folder-1",
    recursive: false,
  })).toEqual({
    type: "asset.list",
    libraryId: "lib-1",
    folderId: "folder-1",
    recursive: false,
    showIgnored: undefined,
  });
});

test("asset.list forwards a non-empty assetIds filter", () => {
  expect(executeAssetQueryMainCommand({
    type: "asset.list.request",
    libraryId: "lib-1",
    recursive: true,
    assetIds: ["asset-1"],
  })).toEqual({
    type: "asset.list",
    libraryId: "lib-1",
    folderId: undefined,
    recursive: true,
    showIgnored: undefined,
    assetIds: ["asset-1"],
  });
});

test("asset.search maps query and paging fields", () => {
  const query = { clauses: [{ field: null, values: ["neon"], exclude: false }] };
  expect(executeAssetQueryMainCommand({
    type: "asset.search.request",
    libraryId: "lib-1",
    query,
    limit: 50,
    offset: 0,
  })).toEqual({
    type: "asset.search",
    libraryId: "lib-1",
    query,
    filters: undefined,
    scope: undefined,
    sort: undefined,
    scopeMode: undefined,
    idsOnly: undefined,
    layoutOnly: undefined,
    limit: 50,
    offset: 0,
    showIgnored: undefined,
  });
});
