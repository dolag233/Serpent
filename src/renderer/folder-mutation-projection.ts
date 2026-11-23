import type {
  LinkedFolderDirectoryMutation,
  LinkedFolderSummary,
  ManagedFolderSummary,
} from "../shared/asset-types";
import {
  encodeLinkedVirtualFolderId,
  linkedDirectoryName,
  parentLinkedRelativePath,
  parseLinkedVirtualFolderId,
} from "../shared/linked-folder-tree";
import type { MutationReceipt } from "../shared/performance-contract";
import type { LibraryViewSessionToken } from "./library-view-session";

export type FolderMutationResult =
  | (ManagedFolderSummary & {
      historyEntryId?: string;
      mutationReceipt?: MutationReceipt;
    })
  | LinkedFolderDirectoryMutation;

export type FolderMutationProjectionState = Readonly<{
  folders: readonly ManagedFolderSummary[];
  linkedFolders: readonly LinkedFolderSummary[];
}>;

export type FolderMutationProjection = Readonly<{
  kind: "create" | "rename";
  folder: FolderMutationResult;
  previousFolderId?: string;
}>;

export type FolderNavigationReadTicket = Readonly<{
  libraryViewToken: LibraryViewSessionToken;
  projectionEpoch: number;
}>;

function sameLibraryView(
  left: LibraryViewSessionToken | null,
  right: LibraryViewSessionToken,
): boolean {
  return left !== null
    && left.libraryId === right.libraryId
    && left.generation === right.generation;
}

/**
 * Keeps navigation summaries issued before a successful folder mutation from
 * replacing its immediate Renderer projection. The epoch belongs to one open
 * library view, so closing/reopening the same library starts a fresh fence.
 */
export class FolderMutationProjectionGate {
  #libraryViewToken: LibraryViewSessionToken | null = null;
  #projectionEpoch = 0;

  issueRead(libraryViewToken: LibraryViewSessionToken): FolderNavigationReadTicket {
    this.#activateView(libraryViewToken);
    return {
      libraryViewToken: { ...libraryViewToken },
      projectionEpoch: this.#projectionEpoch,
    };
  }

  noteMutation(libraryViewToken: LibraryViewSessionToken): boolean {
    if (
      this.#libraryViewToken !== null
      && !sameLibraryView(this.#libraryViewToken, libraryViewToken)
    ) return false;
    this.#activateView(libraryViewToken);
    this.#projectionEpoch += 1;
    return true;
  }

  mayApply(
    ticket: FolderNavigationReadTicket,
    currentLibraryViewToken: LibraryViewSessionToken,
  ): boolean {
    return sameLibraryView(ticket.libraryViewToken, currentLibraryViewToken)
      && sameLibraryView(this.#libraryViewToken, currentLibraryViewToken)
      && ticket.projectionEpoch === this.#projectionEpoch;
  }

  #activateView(libraryViewToken: LibraryViewSessionToken): void {
    if (sameLibraryView(this.#libraryViewToken, libraryViewToken)) return;
    this.#libraryViewToken = { ...libraryViewToken };
    this.#projectionEpoch = 0;
  }
}

/**
 * Apply a successful create/rename response to the current navigation rows.
 * `null` means the current projection does not contain enough information to
 * safely synthesize a linked row; the caller should let its normal refresh
 * reconcile it. The function is pure so the update can run inside a React
 * functional state setter.
 */
export function projectFolderMutation(
  current: FolderMutationProjectionState,
  mutation: FolderMutationProjection,
): FolderMutationProjectionState | null {
  if ("linkedFolderId" in mutation.folder) {
    const linkedFolders = mutation.kind === "create"
      ? projectLinkedFolderCreate(current.linkedFolders, mutation.folder)
      : projectLinkedFolderRename(
          current.linkedFolders,
          mutation.folder,
          mutation.previousFolderId,
        );
    return linkedFolders === null ? null : { ...current, linkedFolders };
  }

  const folders = mutation.kind === "create"
    ? projectManagedFolderCreate(current.folders, mutation.folder)
    : projectManagedFolderRename(
        current.folders,
        mutation.folder,
        mutation.previousFolderId,
      );
  return folders === null ? null : { ...current, folders };
}

function projectManagedFolderCreate(
  current: readonly ManagedFolderSummary[],
  created: ManagedFolderSummary,
): readonly ManagedFolderSummary[] | null {
  if (current.some((folder) => folder.folderId === created.folderId)) return current;
  if (
    created.parentFolderId !== null
    && !current.some((folder) => folder.folderId === created.parentFolderId)
  ) return null;

  const folders = current.map((folder) =>
    folder.folderId === created.parentFolderId
      ? { ...folder, childFolderCount: folder.childFolderCount + 1 }
      : folder,
  );
  folders.push(created);
  return folders;
}

function projectManagedFolderRename(
  current: readonly ManagedFolderSummary[],
  renamed: ManagedFolderSummary,
  previousFolderId: string | undefined,
): readonly ManagedFolderSummary[] | null {
  if (!previousFolderId || renamed.folderId !== previousFolderId) return null;
  const previous = current.find((folder) => folder.folderId === previousFolderId);
  if (!previous) return null;
  const oldPrefix = `${previous.relativePath}/`;

  return current.map((folder) => {
    if (folder.folderId === renamed.folderId) return renamed;
    if (!folder.relativePath.startsWith(oldPrefix)) return folder;
    return {
      ...folder,
      relativePath: renamed.relativePath + folder.relativePath.slice(previous.relativePath.length),
    };
  });
}

function linkedRootId(folder: LinkedFolderSummary): string {
  return folder.linkedFolderId ?? folder.folderId;
}

function projectLinkedFolderCreate(
  current: readonly LinkedFolderSummary[],
  created: LinkedFolderDirectoryMutation,
): readonly LinkedFolderSummary[] | null {
  if (current.some((folder) => folder.folderId === created.folderId)) return current;
  const root = current.find((folder) =>
    linkedRootId(folder) === created.linkedFolderId
    && (folder.relativePath ?? "") === "",
  );
  if (!root) return null;
  if (!current.some((folder) => folder.folderId === created.parentFolderId)) return null;

  return [
    ...current,
    {
      folderId: created.folderId,
      displayName: created.name,
      status: created.status,
      assetCount: 0,
      absoluteRootPath: root.absoluteRootPath,
      linkedFolderId: created.linkedFolderId,
      relativePath: created.relativePath,
      parentFolderId: created.parentFolderId,
    },
  ];
}

function renamedLinkedRootPath(
  absoluteRootPath: string,
  newName: string,
): string | null {
  const separator = Math.max(
    absoluteRootPath.lastIndexOf("/"),
    absoluteRootPath.lastIndexOf("\\"),
  );
  if (separator < 0 || separator === absoluteRootPath.length - 1) return null;
  return absoluteRootPath.slice(0, separator + 1) + newName;
}

function projectLinkedFolderRename(
  current: readonly LinkedFolderSummary[],
  renamed: LinkedFolderDirectoryMutation,
  previousFolderId: string | undefined,
): readonly LinkedFolderSummary[] | null {
  if (!previousFolderId) return null;
  const previous = current.find((folder) => folder.folderId === previousFolderId);
  if (!previous || linkedRootId(previous) !== renamed.linkedFolderId) return null;

  const oldRelativePath = previous.relativePath ?? "";
  if (oldRelativePath === "") {
    const nextRootPath = renamedLinkedRootPath(previous.absoluteRootPath, renamed.name);
    if (!nextRootPath) return null;
    return current.map((folder) => {
      if (linkedRootId(folder) !== renamed.linkedFolderId) return folder;
      return {
        ...folder,
        ...(folder.folderId === previousFolderId
          ? { displayName: renamed.name }
          : {}),
        status: renamed.status,
        absoluteRootPath: nextRootPath,
      };
    });
  }

  const oldPrefix = `${oldRelativePath}/`;
  const renamedRows = current.filter((folder) =>
    linkedRootId(folder) === renamed.linkedFolderId
    && (
      folder.relativePath === oldRelativePath
      || (folder.relativePath ?? "").startsWith(oldPrefix)
    ),
  );
  if (!renamedRows.some((folder) => folder.folderId === previousFolderId)) return null;

  return current.map((folder) => {
    const relativePath = folder.relativePath ?? "";
    if (
      linkedRootId(folder) !== renamed.linkedFolderId
      || (relativePath !== oldRelativePath && !relativePath.startsWith(oldPrefix))
    ) return folder;

    const nextRelativePath = renamed.relativePath + relativePath.slice(oldRelativePath.length);
    const parentRelativePath = parentLinkedRelativePath(nextRelativePath);
    const parentFolderId = parentRelativePath === null
      ? folder.parentFolderId ?? null
      : parentRelativePath === ""
        ? renamed.linkedFolderId
        : encodeLinkedVirtualFolderId(renamed.linkedFolderId, parentRelativePath);
    const isRenamedRoot = folder.folderId === previousFolderId;
    return {
      ...folder,
      folderId: nextRelativePath === ""
        ? renamed.linkedFolderId
        : encodeLinkedVirtualFolderId(renamed.linkedFolderId, nextRelativePath),
      displayName: isRenamedRoot ? renamed.name : linkedDirectoryName(nextRelativePath),
      status: renamed.status,
      relativePath: nextRelativePath,
      parentFolderId: isRenamedRoot ? renamed.parentFolderId : parentFolderId,
    };
  });
}

/** Remap only the renamed linked virtual path and its descendants. */
export function rewriteLinkedFolderIdPrefix(
  folderId: string,
  previousFolderId: string,
  nextFolderId: string,
): string {
  if (folderId === previousFolderId) return nextFolderId;
  const previous = parseLinkedVirtualFolderId(previousFolderId);
  const next = parseLinkedVirtualFolderId(nextFolderId);
  const candidate = parseLinkedVirtualFolderId(folderId);
  if (
    !previous
    || !next
    || !candidate
    || previous.linkedFolderId !== next.linkedFolderId
    || candidate.linkedFolderId !== previous.linkedFolderId
  ) return folderId;
  const oldPrefix = `${previous.relativePath}/`;
  if (!candidate.relativePath.startsWith(oldPrefix)) return folderId;
  return encodeLinkedVirtualFolderId(
    next.linkedFolderId,
    next.relativePath + candidate.relativePath.slice(previous.relativePath.length),
  );
}
