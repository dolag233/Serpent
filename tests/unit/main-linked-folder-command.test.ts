import { expect, test } from "vitest";

import { executeLinkedFolderMainCommand } from "../../src/main/commands/linked-folders";

test("linked-folder.list maps to the worker catalog command", async () => {
  await expect(executeLinkedFolderMainCommand(
    { type: "linked-folder.list.request", libraryId: "lib-1" },
    { createNativeDialogHost: () => ({ getLocale: () => "en", getMainWindow: () => null, isE2e: () => true }) },
  )).resolves.toEqual({
    type: "linked-folder.list",
    libraryId: "lib-1",
  });
});

test("linked-folder.convert forwards the managed target folder", async () => {
  await expect(executeLinkedFolderMainCommand(
    {
      type: "linked-folder.convert.request",
      libraryId: "lib-1",
      folderId: "folder-1",
      targetFolderId: "folder-2",
    },
    { createNativeDialogHost: () => ({ getLocale: () => "en", getMainWindow: () => null, isE2e: () => true }) },
  )).resolves.toEqual({
    type: "linked-folder.convert",
    libraryId: "lib-1",
    folderId: "folder-1",
    targetFolderId: "folder-2",
  });
});
