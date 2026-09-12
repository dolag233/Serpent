/**
 * Persist the open workspace tabs across app restarts (localStorage), keyed per
 * library. Only each tab's current location is stored — forward/back branches
 * are deliberately not restored, so a restored tab starts its own history from
 * the location it was left on.
 */

import {
  createWorkspaceNavHistory,
  seedRestoreLeafLocation,
  type WorkspaceNavLocation,
} from "./workspace-nav-history";
import { resolveSessionStorage, type SessionStorage } from "./session-storage";
import type { WorkspaceTabsState } from "./workspace-tabs";

export type StoredWorkspaceTab = {
  id: string;
  location: WorkspaceNavLocation;
};

export type StoredWorkspaceTabsSession = {
  version: 1;
  activeTabId: string;
  tabs: StoredWorkspaceTab[];
};

/** Bound on what a hand-edited or corrupted entry can make the strip rebuild. */
const MAX_STORED_TABS = 50;

export function workspaceTabsSessionKey(libraryId: string): string {
  return `serpent.workspace-tabs.v1.${libraryId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonBlank(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Validates one stored location; anything unrecognized rejects the whole entry. */
export function parseStoredWorkspaceNavLocation(
  input: unknown,
): WorkspaceNavLocation | null {
  if (!isRecord(input)) return null;
  switch (input.kind) {
    case "all":
      return { kind: "all" };
    case "root":
      return { kind: "root" };
    case "tag-management":
      return { kind: "tag-management" };
    case "trash": {
      if (input.tombstoneId === null || input.tombstoneId === undefined) {
        return { kind: "trash", tombstoneId: null };
      }
      const tombstoneId = nonBlank(input.tombstoneId);
      return tombstoneId ? { kind: "trash", tombstoneId } : null;
    }
    case "folder": {
      const folderId = nonBlank(input.folderId);
      return folderId ? { kind: "folder", folderId } : null;
    }
    case "tag": {
      const tagId = nonBlank(input.tagId);
      return tagId ? { kind: "tag", tagId } : null;
    }
    case "collection": {
      const collectionId = nonBlank(input.collectionId);
      return collectionId
        ? { kind: "collection", collectionId, recursive: input.recursive === true }
        : null;
    }
    case "smart-collection": {
      const collectionId = nonBlank(input.collectionId);
      return collectionId ? { kind: "smart-collection", collectionId } : null;
    }
    case "preview": {
      const assetId = nonBlank(input.assetId);
      return assetId ? { kind: "preview", assetId } : null;
    }
    case "plugin-sidebar": {
      const viewId = nonBlank(input.viewId);
      return viewId ? { kind: "plugin-sidebar", viewId } : null;
    }
    default:
      return null;
  }
}

export function readWorkspaceTabsSession(
  libraryId: string,
  storage?: SessionStorage,
): StoredWorkspaceTabsSession | null {
  const store = resolveSessionStorage(storage);
  if (!store) return null;
  try {
    const value = JSON.parse(
      store.getItem(workspaceTabsSessionKey(libraryId)) ?? "null",
    ) as unknown;
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tabs)) {
      return null;
    }
    const tabs: StoredWorkspaceTab[] = [];
    for (const raw of value.tabs.slice(0, MAX_STORED_TABS)) {
      if (!isRecord(raw)) return null;
      const id = nonBlank(raw.id);
      const location = parseStoredWorkspaceNavLocation(raw.location);
      if (!id || !location || tabs.some((tab) => tab.id === id)) return null;
      tabs.push({ id, location });
    }
    if (tabs.length === 0) return null;
    const storedActiveId = nonBlank(value.activeTabId);
    const activeTabId = tabs.some((tab) => tab.id === storedActiveId)
      ? storedActiveId!
      : tabs[0]!.id;
    return { version: 1, activeTabId, tabs };
  } catch {
    return null;
  }
}

export function writeWorkspaceTabsSession(
  libraryId: string,
  session: StoredWorkspaceTabsSession,
  storage?: SessionStorage,
): void {
  const store = resolveSessionStorage(storage);
  if (!store) return;
  store.setItem(workspaceTabsSessionKey(libraryId), JSON.stringify(session));
}

/**
 * Locations are read off each tab's live history, so the active tab is captured
 * as of right now even though its context (selection, viewport) is only saved
 * when the user leaves it.
 */
export function buildWorkspaceTabsSession(
  state: WorkspaceTabsState,
): StoredWorkspaceTabsSession {
  return {
    version: 1,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      location: tab.history.current,
    })),
  };
}

/**
 * Rebuilds the tab strip from a stored session. Each tab keeps its identity and
 * its location over a synthetic "all assets" base, so Back is meaningful from
 * the first frame — the same seeding a restored browse scope gets.
 */
export function createWorkspaceTabsFromSession(
  session: StoredWorkspaceTabsSession,
): WorkspaceTabsState {
  const tabs = session.tabs.map((stored) => {
    const history = createWorkspaceNavHistory({ kind: "all" });
    seedRestoreLeafLocation(history, stored.location);
    return {
      id: stored.id,
      history,
      selectedAssetIds: [] as string[],
      selectedAssetId: null,
      browseState: null,
      cachedTitle: null,
    };
  });
  const activeTabId = tabs.some((tab) => tab.id === session.activeTabId)
    ? session.activeTabId
    : tabs[0]!.id;
  return { tabs, activeTabId };
}
