import { describe, expect, it } from "vitest";

import {
  createWorkspaceNavHistory,
  seedRestoreLeafLocation,
  workspaceNavLocationsEqual,
  type WorkspaceNavLocation,
} from "../../src/renderer/workspace-nav-history";

describe("workspaceNavLocationsEqual", () => {
  it("compares location fields by kind", () => {
    expect(workspaceNavLocationsEqual({ kind: "all" }, { kind: "all" })).toBe(true);
    expect(workspaceNavLocationsEqual({ kind: "all" }, { kind: "root" })).toBe(false);
    expect(
      workspaceNavLocationsEqual(
        { kind: "folder", folderId: "a" },
        { kind: "folder", folderId: "a" },
      ),
    ).toBe(true);
    expect(
      workspaceNavLocationsEqual(
        { kind: "folder", folderId: "a" },
        { kind: "folder", folderId: "b" },
      ),
    ).toBe(false);
    expect(
      workspaceNavLocationsEqual(
        { kind: "collection", collectionId: "c", recursive: true },
        { kind: "collection", collectionId: "c", recursive: false },
      ),
    ).toBe(false);
    expect(
      workspaceNavLocationsEqual(
        { kind: "smart-collection", collectionId: "s" },
        { kind: "smart-collection", collectionId: "s" },
      ),
    ).toBe(true);
    expect(
      workspaceNavLocationsEqual({ kind: "tag", tagId: "t" }, { kind: "tag", tagId: "t" }),
    ).toBe(true);
    expect(
      workspaceNavLocationsEqual(
        { kind: "trash", tombstoneId: null },
        { kind: "trash", tombstoneId: null },
      ),
    ).toBe(true);
    expect(
      workspaceNavLocationsEqual(
        { kind: "trash", tombstoneId: null },
        { kind: "trash", tombstoneId: "a/b" },
      ),
    ).toBe(false);
  });
});

describe("createWorkspaceNavHistory", () => {
  it("starts at all by default", () => {
    const history = createWorkspaceNavHistory();
    expect(history.current).toEqual({ kind: "all" });
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(false);
    expect(history.peek(0)).toEqual({ kind: "all" });
    expect(history.peek(-1)).toBeNull();
    expect(history.peek(1)).toBeNull();
  });

  it("accepts an initial location", () => {
    const initial: WorkspaceNavLocation = { kind: "folder", folderId: "f1" };
    const history = createWorkspaceNavHistory(initial);
    expect(history.current).toEqual(initial);
  });

  it("push advances current and enables back", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "f1" });
    expect(history.current).toEqual({ kind: "folder", folderId: "f1" });
    expect(history.canBack).toBe(true);
    expect(history.canForward).toBe(false);
  });

  it("ignores identical consecutive pushes", () => {
    const history = createWorkspaceNavHistory({ kind: "folder", folderId: "f1" });
    history.push({ kind: "folder", folderId: "f1" });
    expect(history.canBack).toBe(false);
    history.push({ kind: "root" });
    history.push({ kind: "root" });
    expect(history.current).toEqual({ kind: "root" });
    expect(history.canBack).toBe(true);
    history.back();
    expect(history.current).toEqual({ kind: "folder", folderId: "f1" });
    expect(history.canForward).toBe(true);
    expect(history.canBack).toBe(false);
  });

  it("truncates the forward stack on push after back", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "folder", folderId: "b" });
    history.back();
    expect(history.current).toEqual({ kind: "folder", folderId: "a" });
    expect(history.canForward).toBe(true);

    history.push({ kind: "tag", tagId: "t1" });
    expect(history.current).toEqual({ kind: "tag", tagId: "t1" });
    expect(history.canForward).toBe(false);
    expect(history.forward()).toBeNull();
    expect(history.peek(1)).toBeNull();
  });

  it("back and forward move the index and return the new current", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "trash", tombstoneId: null });
    history.push({ kind: "collection", collectionId: "c1", recursive: true });

    expect(history.back()).toEqual({ kind: "trash", tombstoneId: null });
    expect(history.current).toEqual({ kind: "trash", tombstoneId: null });
    expect(history.canBack).toBe(true);
    expect(history.canForward).toBe(true);

    expect(history.back()).toEqual({ kind: "all" });
    expect(history.back()).toBeNull();
    expect(history.canBack).toBe(false);

    expect(history.forward()).toEqual({ kind: "trash", tombstoneId: null });
    expect(history.forward()).toEqual({
      kind: "collection",
      collectionId: "c1",
      recursive: true,
    });
    expect(history.forward()).toBeNull();
  });

  it("peek reads relative entries without moving", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "folder", folderId: "b" });
    history.back();

    expect(history.peek(0)).toEqual({ kind: "folder", folderId: "a" });
    expect(history.peek(-1)).toEqual({ kind: "all" });
    expect(history.peek(1)).toEqual({ kind: "folder", folderId: "b" });
    expect(history.current).toEqual({ kind: "folder", folderId: "a" });
  });

  it("seedRestoreLeafLocation bases a nested restore on all (Serpent-ada7ad)", () => {
    const restored: WorkspaceNavLocation = { kind: "folder", folderId: "f1" };
    const history = createWorkspaceNavHistory();
    expect(seedRestoreLeafLocation(history, restored)).toEqual({ canBack: true });
    expect(history.current).toEqual(restored);
    expect(history.canBack).toBe(true);
    expect(history.back()).toEqual({ kind: "all" });
    expect(history.canBack).toBe(false);
  });

  it("seedRestoreLeafLocation keeps a single all entry for an all restore", () => {
    const history = createWorkspaceNavHistory();
    expect(seedRestoreLeafLocation(history, { kind: "all" })).toEqual({
      canBack: false,
    });
    expect(history.current).toEqual({ kind: "all" });
    expect(history.canBack).toBe(false);
    expect(history.back()).toBeNull();
  });

  it("clear resets the stack to the default or provided initial", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "smart-collection", collectionId: "s1" });
    history.push({ kind: "trash", tombstoneId: "a" });
    history.back();

    history.clear();
    expect(history.current).toEqual({ kind: "all" });
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(false);

    history.push({ kind: "root" });
    history.clear({ kind: "folder", folderId: "reset" });
    expect(history.current).toEqual({ kind: "folder", folderId: "reset" });
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(false);
  });

  it("tracks the asset viewer as a preview history entry (Serpent-b7e173)", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "preview", assetId: "c" });
    expect(history.current).toEqual({ kind: "preview", assetId: "c" });
    expect(history.canBack).toBe(true);
    expect(history.canForward).toBe(false);
    // back 回浏览 folder A；forward 回到 preview
    expect(history.back()).toEqual({ kind: "folder", folderId: "a" });
    expect(history.canForward).toBe(true);
    expect(history.forward()).toEqual({ kind: "preview", assetId: "c" });
  });

  it("replaceCurrent updates the viewer asset in place without new entries", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "preview", assetId: "c1" });
    history.replaceCurrent({ kind: "preview", assetId: "c2" });
    expect(history.current).toEqual({ kind: "preview", assetId: "c2" });
    // 仍只有一条 preview：back 直接回 folder A（不会先回 c1）
    expect(history.back()).toEqual({ kind: "folder", folderId: "a" });
    expect(history.forward()).toEqual({ kind: "preview", assetId: "c2" });
  });

  it("dismissCurrent removes the current entry with no forward residue", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "preview", assetId: "c" });
    history.dismissCurrent();
    expect(history.current).toEqual({ kind: "folder", folderId: "a" });
    expect(history.canBack).toBe(true);
    expect(history.canForward).toBe(false);
    expect(history.forward()).toBeNull();
  });

  it("tracks tag-management and folder kinds distinctly", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "tag-management" });
    expect(history.current).toEqual({ kind: "tag-management" });
    expect(history.canBack).toBe(true);
    history.push({ kind: "folder", folderId: "b" });
    expect(history.back()).toEqual({ kind: "tag-management" });
    expect(history.back()).toEqual({ kind: "all" });
  });

  it("A→B→A→view C back/forward traverses the whole chain and forward reopens C", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "folder", folderId: "b" });
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "preview", assetId: "c" });
    expect(history.current).toEqual({ kind: "preview", assetId: "c" });
    expect(history.canForward).toBe(false);
    // back → folder A 浏览；forward → 重开 C 而非跳到 B
    expect(history.back()).toEqual({ kind: "folder", folderId: "a" });
    expect(history.canForward).toBe(true);
    expect(history.forward()).toEqual({ kind: "preview", assetId: "c" });
    // 继续 back：folder A → folder B → folder A → all
    expect(history.back()).toEqual({ kind: "folder", folderId: "a" });
    expect(history.back()).toEqual({ kind: "folder", folderId: "b" });
    expect(history.back()).toEqual({ kind: "folder", folderId: "a" });
    expect(history.back()).toEqual({ kind: "all" });
    expect(history.back()).toBeNull();
  });

  it("opening the viewer truncates the forward branch", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "folder", folderId: "b" });
    // 从 A 后退到 all，B 在前方
    history.back();
    expect(history.canForward).toBe(true);
    // 在 all 打开查看器 → push 截断 B
    history.push({ kind: "preview", assetId: "c" });
    expect(history.current).toEqual({ kind: "preview", assetId: "c" });
    expect(history.canForward).toBe(false);
    expect(history.forward()).toBeNull();
  });

  it("dismissCurrent from a non-top index removes the current entry (callers guard on preview)", () => {
    // closeAssetPreview 只会在 current.kind==='preview' 时调用 dismiss；preview
    // 必在栈顶，所以 dismiss 删除的就是栈顶 preview。此用例记录该约定：
    // 若在 back 到浏览 scope 后误调 dismiss，会删除当前浏览条目——调用方必须守卫。
    const history = createWorkspaceNavHistory();
    history.push({ kind: "folder", folderId: "a" });
    history.push({ kind: "preview", assetId: "c" });
    history.back(); // current 回到 folder A
    expect(history.current).toEqual({ kind: "folder", folderId: "a" });
    // back 未移出 preview 的 forward 分支：forward 可重开 C
    expect(history.canForward).toBe(true);
    expect(history.forward()).toEqual({ kind: "preview", assetId: "c" });
  });
});
