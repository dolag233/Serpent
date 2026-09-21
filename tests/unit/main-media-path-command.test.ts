import { expect, test } from "vitest";

import { executeMediaPathMainCommand } from "../../src/main/commands/media-paths";

test("asset.preview maps optional viewer fields", () => {
  expect(executeMediaPathMainCommand({
    type: "asset.preview.request",
    libraryId: "lib-1",
    assetId: "asset-1",
    mode: "client",
    intent: "viewer",
  })).toEqual({
    type: "media.get-preview-artifact",
    libraryId: "lib-1",
    assetId: "asset-1",
    intent: "viewer",
  });
});

test("asset.close-preview stays on the renderer UI path", () => {
  expect(executeMediaPathMainCommand({
    type: "asset.close-preview.request",
    libraryId: "lib-1",
    assetId: "asset-1",
  })).toBeUndefined();
});

test("asset.copy-files maps onto media.get-asset-paths", () => {
  expect(executeMediaPathMainCommand({
    type: "asset.copy-files.request",
    libraryId: "lib-1",
    assetIds: ["asset-1", "asset-2"],
  })).toEqual({
    type: "media.get-asset-paths",
    libraryId: "lib-1",
    assetIds: ["asset-1", "asset-2"],
  });
});
