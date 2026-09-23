import { describe, expect, it } from "vitest";

import {
  folderBatchProcessCount,
  planFolderBatch,
  type FolderBatchLinkedFolder,
  type FolderBatchManagedFolder,
} from "../../src/renderer/folder-batch-actions";

// Serpent-d7acfa：多选文件夹批量动作的资格与跳过原因。
describe("folder batch planning", () => {
  const managedFolders: FolderBatchManagedFolder[] = [
    { folderId: "m-1", name: "Alpha", relativePath: "Alpha" },
    { folderId: "m-2", name: "Beta", relativePath: "Alpha/Beta" },
  ];
  const linkedFolders: FolderBatchLinkedFolder[] = [
    { folderId: "l-root", name: "Linked", relativePath: "" },
    { folderId: "lfv:l-root/sub", name: "sub", relativePath: "sub" },
  ];

  const plan = (
    folderIds: readonly string[],
    action: Parameters<typeof planFolderBatch>[0]["action"],
  ) =>
    planFolderBatch({
      folderIds,
      managedFolders,
      linkedFolders,
      action,
    });

  it("trashes every selected managed folder and skips linked ones", () => {
    const result = plan(["m-1", "m-2", "l-root", "lfv:l-root/sub"], "trash");
    expect(result.targets.map((target) => target.folderId)).toEqual([
      "m-1",
      "m-2",
    ]);
    // 链接根与链接子目录都没有回收站语义（2026-09-15 决定）
    expect(result.skips).toEqual([{ reason: "linked", count: 2 }]);
    expect(result.skipCount).toBe(2);
  });

  it("sets icon/color on managed folders and linked roots only", () => {
    const result = plan(
      ["m-1", "l-root", "lfv:l-root/sub", "missing-folder"],
      "appearance",
    );
    expect(result.targets).toEqual([
      {
        folderId: "m-1",
        kind: "managed-folder",
        name: "Alpha",
        relativePath: "Alpha",
        linkedRelativePath: null,
      },
      {
        folderId: "l-root",
        kind: "linked-folder",
        name: "Linked",
        relativePath: "",
        linkedRelativePath: null,
      },
    ]);
    expect(result.skips).toEqual([
      { reason: "linked", count: 1 },
      { reason: "unresolved", count: 1 },
    ]);
    expect(folderBatchProcessCount(result)).toBe(2);
  });

  it("ignores managed folders, linked roots, and linked subdirectories", () => {
    const result = plan(["m-2", "l-root", "lfv:l-root/sub"], "ignore");
    expect(result.targets.map((target) => target.folderId)).toEqual([
      "m-2",
      "l-root",
      "lfv:l-root/sub",
    ]);
    expect(result.targets[2]).toEqual({
      folderId: "lfv:l-root/sub",
      kind: "linked-folder",
      name: "sub",
      relativePath: "sub",
      linkedRelativePath: "sub",
    });
    expect(result.skips).toEqual([]);
  });

  it("treats unknown ids as unresolved instead of guessing", () => {
    const result = plan(["nope-1", "nope-2"], "delete-from-disk");
    expect(result.targets).toEqual([]);
    expect(result.skips).toEqual([{ reason: "unresolved", count: 2 }]);
    expect(result.skipCount).toBe(2);
  });

  it("keeps the selection order inside each action's target list", () => {
    const result = plan(["m-2", "m-1"], "delete-from-disk");
    expect(result.targets.map((target) => target.folderId)).toEqual(["m-2", "m-1"]);
  });
});
