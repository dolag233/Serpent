import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEW_FOLDER_NAME,
  changeInlineFolderEditValue,
  failInlineFolderEdit,
  inlineCreateRowIndex,
  inlineFolderEditDepth,
  isSameInlineFolderEditSession,
  markInlineFolderEditSubmitting,
  resolveInlineFolderEditCommit,
  startInlineFolderCreate,
  startInlineFolderRename,
  type InlineFolderEditState,
} from "../../src/renderer/inline-folder-edit";
import type { UnifiedDirectoryNavEntry } from "../../src/renderer/unified-directory-nav";

const managedEntry = (
  folderId: string,
  depth: number,
  parentFolderId: string | null = null,
): UnifiedDirectoryNavEntry => ({
  kind: "managed",
  folderId,
  name: folderId,
  depth,
  parentFolderId,
});

describe("startInlineFolderCreate", () => {
  it("prefills the default name so Enter accepts it and typing replaces it", () => {
    expect(startInlineFolderCreate(null)).toEqual({
      kind: "create",
      parentFolderId: null,
      value: DEFAULT_NEW_FOLDER_NAME,
      error: null,
      submitting: false,
    });
  });

  it("captures the target parent for the subfolder flow", () => {
    const session = startInlineFolderCreate("parent-1");
    expect(session.kind).toBe("create");
    expect(session).toMatchObject({ parentFolderId: "parent-1" });
  });
});

describe("startInlineFolderRename", () => {
  it("prefills the current name and remembers it as the no-op baseline", () => {
    expect(startInlineFolderRename("f1", "原画")).toEqual({
      kind: "rename",
      folderId: "f1",
      originalName: "原画",
      value: "原画",
      error: null,
      submitting: false,
    });
  });
});

describe("changeInlineFolderEditValue", () => {
  it("updates the value and clears a previous inline failure", () => {
    const failed = failInlineFolderEdit(
      startInlineFolderCreate(null),
      "已存在同名文件夹或文件。",
    );
    const next = changeInlineFolderEditValue(failed, "素材");
    expect(next).toMatchObject({ value: "素材", error: null });
  });
});

describe("resolveInlineFolderEditCommit", () => {
  it("cancels a create whose value is blank instead of submitting", () => {
    const session = changeInlineFolderEditValue(
      startInlineFolderCreate(null),
      "   ",
    );
    expect(resolveInlineFolderEditCommit(session)).toEqual({
      action: "cancel",
    });
  });

  it("cancels a rename whose value is blank instead of submitting", () => {
    const session = changeInlineFolderEditValue(
      startInlineFolderRename("f1", "原画"),
      "",
    );
    expect(resolveInlineFolderEditCommit(session)).toEqual({
      action: "cancel",
    });
  });

  it("treats re-committing the original rename name as a no-op cancel", () => {
    const session = changeInlineFolderEditValue(
      startInlineFolderRename("f1", "原画"),
      "  原画  ",
    );
    expect(resolveInlineFolderEditCommit(session)).toEqual({
      action: "cancel",
    });
  });

  it("submits the trimmed create name", () => {
    const session = changeInlineFolderEditValue(
      startInlineFolderCreate("parent-1"),
      "  子级 ",
    );
    expect(resolveInlineFolderEditCommit(session)).toEqual({
      action: "submit",
      name: "子级",
    });
  });

  it("submits a changed rename name", () => {
    const session = changeInlineFolderEditValue(
      startInlineFolderRename("f1", "原画"),
      "角色原画",
    );
    expect(resolveInlineFolderEditCommit(session)).toEqual({
      action: "submit",
      name: "角色原画",
    });
  });

  it("keeps editing when a request is already in flight", () => {
    const session = markInlineFolderEditSubmitting(
      startInlineFolderCreate(null),
    );
    expect(resolveInlineFolderEditCommit(session)).toEqual({
      action: "keep-editing",
    });
  });
});

describe("markInlineFolderEditSubmitting / failInlineFolderEdit", () => {
  it("blocks duplicate submits and clears the error while in flight", () => {
    const failed = failInlineFolderEdit(
      startInlineFolderCreate(null),
      "名称包含不支持的字符。",
    );
    const submitting = markInlineFolderEditSubmitting(failed);
    expect(submitting).toMatchObject({ submitting: true, error: null });
  });

  it("keeps the typed value and surfaces the reason so the row stays open", () => {
    const session = changeInlineFolderEditValue(
      startInlineFolderRename("f1", "素材甲"),
      "素材乙",
    );
    const failed = failInlineFolderEdit(
      markInlineFolderEditSubmitting(session),
      "已存在同名文件夹或文件。",
    );
    expect(failed).toMatchObject({
      value: "素材乙",
      submitting: false,
      error: "已存在同名文件夹或文件。",
    });
  });
});

describe("isSameInlineFolderEditSession", () => {
  it("matches create sessions by parent folder", () => {
    const a = startInlineFolderCreate("p1");
    const sameParent = changeInlineFolderEditValue(
      startInlineFolderCreate("p1"),
      "别的名字",
    );
    const otherParent = startInlineFolderCreate("p2");
    expect(isSameInlineFolderEditSession(a, sameParent)).toBe(true);
    expect(isSameInlineFolderEditSession(a, otherParent)).toBe(false);
  });

  it("matches rename sessions by folder id and never across kinds", () => {
    const rename = startInlineFolderRename("f1", "原画");
    const sameFolder = changeInlineFolderEditValue(
      startInlineFolderRename("f1", "原画"),
      "新名",
    );
    const otherFolder = startInlineFolderRename("f2", "原画");
    const create: InlineFolderEditState = startInlineFolderCreate("f1");
    expect(isSameInlineFolderEditSession(rename, sameFolder)).toBe(true);
    expect(isSameInlineFolderEditSession(rename, otherFolder)).toBe(false);
    expect(isSameInlineFolderEditSession(rename, create)).toBe(false);
  });
});

describe("inlineFolderEditDepth", () => {
  const entries = [
    managedEntry("root-a", 1),
    managedEntry("child-a", 2, "root-a"),
  ];

  it("nests a create row one level under its parent", () => {
    expect(
      inlineFolderEditDepth(startInlineFolderCreate("root-a"), entries),
    ).toBe(2);
    expect(
      inlineFolderEditDepth(startInlineFolderCreate("child-a"), entries),
    ).toBe(3);
  });

  it("places a root-level create at depth 1", () => {
    expect(inlineFolderEditDepth(startInlineFolderCreate(null), entries)).toBe(
      1,
    );
  });

  it("keeps the folder's own depth for a rename row", () => {
    expect(
      inlineFolderEditDepth(startInlineFolderRename("child-a", "子级"), entries),
    ).toBe(2);
  });

  it("falls back to depth 1 when the entries no longer contain the target", () => {
    expect(
      inlineFolderEditDepth(startInlineFolderCreate("gone"), entries),
    ).toBe(1);
    expect(
      inlineFolderEditDepth(startInlineFolderRename("gone", "旧名"), entries),
    ).toBe(1);
  });
});

describe("inlineCreateRowIndex", () => {
  const entries = [
    managedEntry("root-a", 1),
    managedEntry("child-a", 2, "root-a"),
    managedEntry("root-b", 1),
  ];

  it("inserts at the top of the list when creating at the library root", () => {
    expect(inlineCreateRowIndex(entries, null)).toBe(0);
  });

  it("inserts directly after the parent as its first child", () => {
    // Before the existing child-a row, not after it.
    expect(inlineCreateRowIndex(entries, "root-a")).toBe(1);
    expect(inlineCreateRowIndex(entries, "root-b")).toBe(3);
  });

  it("falls back to the top when the parent is no longer listed", () => {
    expect(inlineCreateRowIndex(entries, "gone")).toBe(0);
  });
});
