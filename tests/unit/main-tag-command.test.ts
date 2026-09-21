import { expect, test } from "vitest";

import { executeTagMainCommand } from "../../src/main/commands/tags";

test("tag.assign forwards asset and tag ids", () => {
  expect(executeTagMainCommand({
    type: "tag.assign.request",
    libraryId: "lib-1",
    assetIds: ["asset-1"],
    tagIds: ["tag-1"],
  })).toEqual({
    type: "tag.assign",
    libraryId: "lib-1",
    assetIds: ["asset-1"],
    tagIds: ["tag-1"],
  });
});

test("tag.list maps to the worker catalog command", () => {
  expect(executeTagMainCommand({
    type: "tag.list.request",
    libraryId: "lib-1",
  })).toEqual({
    type: "tag.list",
    libraryId: "lib-1",
  });
});
