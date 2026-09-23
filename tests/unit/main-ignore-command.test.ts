import { expect, test } from "vitest";

import { executeIgnoreMainCommand } from "../../src/main/commands/ignore";

test("ignore.set maps managed path ignore flags", () => {
  expect(executeIgnoreMainCommand({
    type: "ignore.set.request",
    libraryId: "lib-1",
    locationKind: "managed",
    relativePath: "refs",
    pathKind: "folder",
    ignored: true,
  })).toEqual({
    type: "ignore.set",
    libraryId: "lib-1",
    locationKind: "managed",
    linkedFolderId: undefined,
    relativePath: "refs",
    pathKind: "folder",
    ignored: true,
  });
});

test("ignore.gitignore.preview maps draft content", () => {
  expect(executeIgnoreMainCommand({
    type: "ignore.gitignore.preview.request",
    libraryId: "lib-1",
    content: ".*/\n",
  })).toEqual({
    type: "ignore.gitignore.preview",
    libraryId: "lib-1",
    content: ".*/\n",
  });
});

test("unrelated renderer requests fall through", () => {
  expect(executeIgnoreMainCommand({ type: "library.list.request" })).toBeUndefined();
});
