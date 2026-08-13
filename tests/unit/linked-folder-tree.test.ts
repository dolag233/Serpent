import { describe, expect, it } from "vitest";

import {
  collectLinkedDirectoryPrefixes,
  directChildLinkedDirectories,
  encodeLinkedVirtualFolderId,
  linkedAssetIsDirectChild,
  linkedAssetIsUnderDirectory,
  linkedFolderDepth,
  linkedRevealFolderId,
  parseLinkedVirtualFolderId,
} from "../../src/shared/linked-folder-tree";

describe("linked-folder-tree", () => {
  it("encodes and parses virtual subdirectory ids", () => {
    const folderId = encodeLinkedVirtualFolderId("root-1", "notes/2024");
    expect(folderId).toBe("lfv:root-1/notes/2024");
    expect(parseLinkedVirtualFolderId(folderId)).toEqual({
      linkedFolderId: "root-1",
      relativePath: "notes/2024",
    });
    expect(encodeLinkedVirtualFolderId("root-1", "")).toBe("root-1");
    expect(parseLinkedVirtualFolderId("root-1")).toBeNull();
  });

  it("collects prefixes and direct children from asset paths", () => {
    const prefixes = collectLinkedDirectoryPrefixes([
      "a.png",
      "notes/readme.md",
      "notes/2024/draft.txt",
    ]);
    expect(prefixes).toEqual(["notes", "notes/2024"]);
    expect(directChildLinkedDirectories(prefixes, "")).toEqual(["notes"]);
    expect(directChildLinkedDirectories(prefixes, "notes")).toEqual(["notes/2024"]);
  });

  it("matches direct children and descendants", () => {
    expect(linkedAssetIsDirectChild("a.png", "")).toBe(true);
    expect(linkedAssetIsDirectChild("notes/a.png", "")).toBe(false);
    expect(linkedAssetIsDirectChild("notes/a.png", "notes")).toBe(true);
    expect(linkedAssetIsUnderDirectory("notes/2024/a.png", "notes")).toBe(true);
    expect(linkedAssetIsUnderDirectory("other/a.png", "notes")).toBe(false);
    expect(linkedFolderDepth("")).toBe(1);
    expect(linkedFolderDepth("notes/2024")).toBe(3);
  });

  it("resolves reveal ids for linked subdirectories", () => {
    expect(linkedRevealFolderId("root-1", undefined)).toBe("root-1");
    expect(linkedRevealFolderId("root-1", "notes")).toBe("lfv:root-1/notes");
  });
});
