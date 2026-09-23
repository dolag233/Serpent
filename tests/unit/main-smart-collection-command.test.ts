import { expect, test } from "vitest";

import { executeSmartCollectionMainCommand } from "../../src/main/commands/smart-collections";

test("smart-collection.list maps to the worker catalog command", () => {
  expect(executeSmartCollectionMainCommand({
    type: "smart-collection.list.request",
    libraryId: "lib-1",
  })).toEqual({
    type: "smart-collection.list",
    libraryId: "lib-1",
  });
});

test("unrelated renderer requests fall through", () => {
  expect(executeSmartCollectionMainCommand({
    type: "library.list.request",
  })).toBeUndefined();
});
