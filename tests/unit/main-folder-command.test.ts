import { expect, test } from "vitest";

import { executeFolderMainCommand } from "../../src/main/commands/folders";
import type { RendererRequest } from "../../src/shared/protocol/requests";

function folderRequest(request: RendererRequest): RendererRequest {
  return request;
}

test("unrelated renderer requests fall through", async () => {
  await expect(executeFolderMainCommand(
    folderRequest({ type: "library.list.request" }),
  )).resolves.toBeUndefined();
});

test("folder.list maps showIgnored through to the worker command", async () => {
  await expect(executeFolderMainCommand(
    folderRequest({ type: "folder.list.request", libraryId: "lib-1", showIgnored: true }),
  )).resolves.toEqual({
    type: "folder.list",
    libraryId: "lib-1",
    showIgnored: true,
  });
});

test("folder.open-in-file-manager resolves a path command for Main", async () => {
  await expect(executeFolderMainCommand(
    folderRequest({
      type: "folder.open-in-file-manager.request",
      libraryId: "lib-1",
      folderId: "folder-1",
    }),
  )).resolves.toEqual({
    type: "folder.get-path",
    libraryId: "lib-1",
    folderId: "folder-1",
  });
});

test("folder.paste stays on the Main clipboard import path", async () => {
  await expect(executeFolderMainCommand(
    folderRequest({
      type: "folder.paste.request",
      libraryId: "lib-1",
      folderId: "folder-1",
    }),
  )).resolves.toBeUndefined();
});

test("selection.trash forwards asset and folder ids", async () => {
  await expect(executeFolderMainCommand(
    folderRequest({
      type: "selection.trash.request",
      libraryId: "lib-1",
      assetIds: ["asset-1"],
      folderIds: ["folder-1"],
    }),
  )).resolves.toEqual({
    type: "selection.trash",
    libraryId: "lib-1",
    assetIds: ["asset-1"],
    folderIds: ["folder-1"],
  });
});
