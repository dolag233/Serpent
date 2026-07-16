import { describe, expect, it } from "vitest";

import {
  createWorkspaceNavHistory,
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
    expect(workspaceNavLocationsEqual({ kind: "trash" }, { kind: "trash" })).toBe(true);
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
    history.push({ kind: "trash" });
    history.push({ kind: "collection", collectionId: "c1", recursive: true });

    expect(history.back()).toEqual({ kind: "trash" });
    expect(history.current).toEqual({ kind: "trash" });
    expect(history.canBack).toBe(true);
    expect(history.canForward).toBe(true);

    expect(history.back()).toEqual({ kind: "all" });
    expect(history.back()).toBeNull();
    expect(history.canBack).toBe(false);

    expect(history.forward()).toEqual({ kind: "trash" });
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

  it("clear resets the stack to the default or provided initial", () => {
    const history = createWorkspaceNavHistory();
    history.push({ kind: "smart-collection", collectionId: "s1" });
    history.push({ kind: "trash" });
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
});
