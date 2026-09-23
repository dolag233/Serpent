import { describe, expect, it } from "vitest";

import {
  countLinkedDirectoryAssets,
  countLinkedDirectoryChildren,
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
    expect(linkedFolderDepth("")).toBe(0);
    expect(linkedFolderDepth("notes")).toBe(1);
    expect(linkedFolderDepth("notes/2024")).toBe(2);
  });

  it("counts direct and recursive assets by walking each path's ancestors", () => {
    const counts = countLinkedDirectoryAssets([
      "root.png",
      "notes/readme.md",
      "notes/2024/draft.txt",
      "notes/2024/final.txt",
      "other/image.webp",
    ]);

    expect(counts.get("")).toEqual({ direct: 1, recursive: 5 });
    expect(counts.get("notes")).toEqual({ direct: 1, recursive: 3 });
    expect(counts.get("notes/2024")).toEqual({ direct: 2, recursive: 2 });
    expect(counts.get("other")).toEqual({ direct: 1, recursive: 1 });
    expect(counts.get("missing")).toBeUndefined();
  });

  it("counts direct virtual children in a single pass", () => {
    expect(countLinkedDirectoryChildren(["notes", "notes/2024", "notes/2025", "other"]))
      .toEqual(new Map([["", 2], ["notes", 2]]));
  });

  it("resolves reveal ids for linked subdirectories", () => {
    expect(linkedRevealFolderId("root-1", undefined)).toBe("root-1");
    expect(linkedRevealFolderId("root-1", "notes")).toBe("lfv:root-1/notes");
  });
});
