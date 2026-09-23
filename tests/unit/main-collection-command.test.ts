import { expect, test } from "vitest";

import { executeCollectionMainCommand } from "../../src/main/commands/collections";

test("collection.list maps to the worker catalog command", () => {
  expect(executeCollectionMainCommand({
    type: "collection.list.request",
    libraryId: "lib-1",
  })).toEqual({
    type: "collection.list",
    libraryId: "lib-1",
  });
});

test("collection.assets.list forwards the recursive flag", () => {
  expect(executeCollectionMainCommand({
    type: "collection.assets.list.request",
    libraryId: "lib-1",
    collectionId: "col-1",
    recursive: true,
  })).toEqual({
    type: "collection.assets.list",
    libraryId: "lib-1",
    collectionId: "col-1",
    recursive: true,
  });
});
