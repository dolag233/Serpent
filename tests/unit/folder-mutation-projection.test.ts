import { describe, expect, it } from "vitest";

import type {
  LinkedFolderDirectoryMutation,
  LinkedFolderSummary,
  ManagedFolderSummary,
} from "../../src/shared/asset-types";
import { encodeLinkedVirtualFolderId } from "../../src/shared/linked-folder-tree";
import {
  FolderMutationProjectionGate,
  projectFolderMutation,
  rewriteLinkedFolderIdPrefix,
  type FolderMutationProjectionState,
} from "../../src/renderer/folder-mutation-projection";
import type { LibraryViewSessionToken } from "../../src/renderer/library-view-session";

const managedFolder = (
  values: Partial<ManagedFolderSummary> & Pick<ManagedFolderSummary, "folderId" | "relativePath">,
): ManagedFolderSummary => ({
  folderId: values.folderId,
  parentFolderId: values.parentFolderId ?? null,
  name: values.name ?? values.folderId,
  relativePath: values.relativePath,
  directAssetCount: values.directAssetCount ?? 0,
  childFolderCount: values.childFolderCount ?? 0,
  ...(values.createdAt ? { createdAt: values.createdAt } : {}),
  appearance: values.appearance ?? null,
});

const linkedFolder = (
  values: Partial<LinkedFolderSummary> & Pick<LinkedFolderSummary, "folderId" | "absoluteRootPath">,
): LinkedFolderSummary => ({
  folderId: values.folderId,
  displayName: values.displayName ?? values.folderId,
  status: values.status ?? "available",
  assetCount: values.assetCount ?? 0,
  absoluteRootPath: values.absoluteRootPath,
  linkedFolderId: values.linkedFolderId ?? values.folderId,
  relativePath: values.relativePath ?? "",
  parentFolderId: values.parentFolderId ?? null,
  ...(values.createdAt ? { createdAt: values.createdAt } : {}),
  ...(values.appearance ? { appearance: values.appearance } : {}),
});

const linkedMutation = (
  values: LinkedFolderDirectoryMutation,
): LinkedFolderDirectoryMutation => values;

describe("projectFolderMutation", () => {
  it("adds a managed folder and increments its direct parent only once", () => {
    const initial: FolderMutationProjectionState = {
      folders: [managedFolder({ folderId: "parent", relativePath: "parent", childFolderCount: 2 })],
      linkedFolders: [],
    };
    const folder = managedFolder({
      folderId: "created",
      parentFolderId: "parent",
      relativePath: "parent/created",
    });

    const first = projectFolderMutation(initial, { kind: "create", folder });
    expect(first?.folders).toEqual([
      { ...initial.folders[0], childFolderCount: 3 },
      folder,
    ]);
    expect(projectFolderMutation(first!, { kind: "create", folder })?.folders).toBe(first!.folders);
  });

  it("renames a managed subtree while retaining descendant counts and appearance", () => {
    const initial: FolderMutationProjectionState = {
      folders: [
        managedFolder({ folderId: "root", relativePath: "old", childFolderCount: 1 }),
        managedFolder({ folderId: "child", parentFolderId: "root", relativePath: "old/child", directAssetCount: 4, childFolderCount: 2, appearance: { glyphKind: "emoji", glyphValue: "🎨", colorId: null } }),
        managedFolder({ folderId: "nested", parentFolderId: "child", relativePath: "old/child/nested", directAssetCount: 7 }),
        managedFolder({ folderId: "sibling", relativePath: "oldish/sibling" }),
      ],
      linkedFolders: [],
    };
    const renamed = managedFolder({ folderId: "root", relativePath: "new", name: "new", childFolderCount: 1 });
    const result = projectFolderMutation(initial, {
      kind: "rename",
      previousFolderId: "root",
      folder: renamed,
    });

    expect(result?.folders).toEqual([
      renamed,
      { ...initial.folders[1], relativePath: "new/child" },
      { ...initial.folders[2], relativePath: "new/child/nested" },
      initial.folders[3],
    ]);
  });

  it("projects a linked create from its root metadata and remains idempotent", () => {
    const root = linkedFolder({
      folderId: "linked-root",
      linkedFolderId: "linked-root",
      displayName: "Source",
      absoluteRootPath: "fixture-volume/source",
    });
    const initial: FolderMutationProjectionState = { folders: [], linkedFolders: [root] };
    const created = linkedMutation({
      folderId: encodeLinkedVirtualFolderId("linked-root", "new-dir"),
      linkedFolderId: "linked-root",
      parentFolderId: "linked-root",
      name: "new-dir",
      relativePath: "new-dir",
      status: "available",
    });

    const first = projectFolderMutation(initial, { kind: "create", folder: created });
    expect(first?.linkedFolders).toEqual([
      root,
      {
        ...root,
        folderId: created.folderId,
        displayName: "new-dir",
        assetCount: 0,
        relativePath: "new-dir",
        parentFolderId: "linked-root",
      },
    ]);
    expect(projectFolderMutation(first!, { kind: "create", folder: created })?.linkedFolders)
      .toBe(first!.linkedFolders);
  });

  it("renames linked virtual descendants and rebuilds their parent ids", () => {
    const root = linkedFolder({
      folderId: "linked-root",
      linkedFolderId: "linked-root",
      displayName: "Source",
      absoluteRootPath: "fixture-volume/source",
    });
    const parent = linkedFolder({
      folderId: encodeLinkedVirtualFolderId("linked-root", "parent"),
      linkedFolderId: "linked-root",
      relativePath: "parent",
      parentFolderId: "linked-root",
      absoluteRootPath: root.absoluteRootPath,
    });
    const oldId = encodeLinkedVirtualFolderId("linked-root", "parent/old");
    const child = linkedFolder({
      folderId: oldId,
      linkedFolderId: "linked-root",
      relativePath: "parent/old",
      parentFolderId: parent.folderId,
      assetCount: 5,
      absoluteRootPath: root.absoluteRootPath,
    });
    const descendant = linkedFolder({
      folderId: encodeLinkedVirtualFolderId("linked-root", "parent/old/nested"),
      linkedFolderId: "linked-root",
      displayName: "nested",
      relativePath: "parent/old/nested",
      parentFolderId: oldId,
      assetCount: 2,
      absoluteRootPath: root.absoluteRootPath,
    });
    const sibling = linkedFolder({
      folderId: encodeLinkedVirtualFolderId("linked-root", "parent/older"),
      linkedFolderId: "linked-root",
      relativePath: "parent/older",
      parentFolderId: parent.folderId,
      absoluteRootPath: root.absoluteRootPath,
    });
    const nextId = encodeLinkedVirtualFolderId("linked-root", "parent/new");
    const initial: FolderMutationProjectionState = {
      folders: [],
      linkedFolders: [root, parent, child, descendant, sibling],
    };
    const result = projectFolderMutation(initial, {
      kind: "rename",
      previousFolderId: oldId,
      folder: linkedMutation({
        folderId: nextId,
        linkedFolderId: "linked-root",
        parentFolderId: parent.folderId,
        name: "new",
        relativePath: "parent/new",
        status: "available",
      }),
    });

    expect(result?.linkedFolders).toEqual([
      root,
      parent,
      { ...child, folderId: nextId, displayName: "new", relativePath: "parent/new" },
      {
        ...descendant,
        folderId: encodeLinkedVirtualFolderId("linked-root", "parent/new/nested"),
        relativePath: "parent/new/nested",
        parentFolderId: nextId,
      },
      sibling,
    ]);
    expect(rewriteLinkedFolderIdPrefix(
      descendant.folderId,
      oldId,
      nextId,
    )).toBe(encodeLinkedVirtualFolderId("linked-root", "parent/new/nested"));
    expect(rewriteLinkedFolderIdPrefix(sibling.folderId, oldId, nextId)).toBe(sibling.folderId);
  });

  it("renames linked root metadata and refuses to invent a missing root path", () => {
    const root = linkedFolder({
      folderId: "linked-root",
      linkedFolderId: "linked-root",
      displayName: "Old root",
      absoluteRootPath: "fixture-volume/physical-root",
    });
    const child = linkedFolder({
      folderId: encodeLinkedVirtualFolderId("linked-root", "child"),
      linkedFolderId: "linked-root",
      relativePath: "child",
      parentFolderId: "linked-root",
      absoluteRootPath: root.absoluteRootPath,
    });
    const mutation = linkedMutation({
      folderId: "linked-root",
      linkedFolderId: "linked-root",
      parentFolderId: null,
      name: "Renamed root",
      relativePath: "",
      status: "available",
    });
    const initial: FolderMutationProjectionState = { folders: [], linkedFolders: [root, child] };

    expect(projectFolderMutation(initial, {
      kind: "rename",
      previousFolderId: root.folderId,
      folder: mutation,
    })?.linkedFolders).toEqual([
      { ...root, displayName: "Renamed root", absoluteRootPath: "fixture-volume/Renamed root" },
      { ...child, absoluteRootPath: "fixture-volume/Renamed root" },
    ]);
    expect(projectFolderMutation(
      { folders: [], linkedFolders: [] },
      { kind: "rename", previousFolderId: root.folderId, folder: mutation },
    )).toBeNull();
  });
});

describe("FolderMutationProjectionGate", () => {
  const firstView: LibraryViewSessionToken = { libraryId: "library", generation: 3 };
  const reopenedView: LibraryViewSessionToken = { libraryId: "library", generation: 4 };

  it("rejects pre-mutation summaries and accepts reads from the current epoch", () => {
    const gate = new FolderMutationProjectionGate();
    const before = gate.issueRead(firstView);
    expect(gate.noteMutation(firstView)).toBe(true);
    expect(gate.mayApply(before, firstView)).toBe(false);

    const after = gate.issueRead(firstView);
    expect(gate.mayApply(after, firstView)).toBe(true);
  });

  it("rejects summaries from a closed and reopened view with the same library id", () => {
    const gate = new FolderMutationProjectionGate();
    const oldTicket = gate.issueRead(firstView);
    const newTicket = gate.issueRead(reopenedView);
    expect(gate.mayApply(oldTicket, reopenedView)).toBe(false);
    expect(gate.mayApply(newTicket, reopenedView)).toBe(true);
    expect(gate.noteMutation(firstView)).toBe(false);
  });
});
