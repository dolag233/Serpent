/**
 * Persist browse scope + selection across app restarts (localStorage).
 * Extracted from App.tsx for Serpent-uye — pure read/write/build helpers.
 */

export type StoredBrowserSession = {
  version: 1;
  scope:
    | { kind: "all" | "root" | "trash" }
    | {
        kind: "folder" | "tag" | "collection" | "smart";
        id: string;
        name?: string;
      };
  selectedAssetId: string;
  selectedAssetName: string;
};

export type BrowserSessionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type BrowseStateForSession = {
  showTrash: boolean;
  activeTagId: string | null;
  activeTagName: string | undefined;
  activeCollectionId: string | null;
  activeSmartCollectionId: string | null;
  assetScope: "all" | "root" | string;
  selectedAssetId: string;
  selectedAssetName: string;
};

const SCOPED_KINDS = new Set(["folder", "tag", "collection", "smart"]);

export function browserSessionKey(libraryId: string): string {
  return `serpent.browser-session.v1.${libraryId}`;
}

function resolveStorage(
  storage?: BrowserSessionStorage,
): BrowserSessionStorage | null {
  if (storage) return storage;
  const ls = (globalThis as { localStorage?: BrowserSessionStorage })
    .localStorage;
  return ls ?? null;
}

export function readBrowserSession(
  libraryId: string,
  storage?: BrowserSessionStorage,
): StoredBrowserSession | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const value = JSON.parse(
      store.getItem(browserSessionKey(libraryId)) ?? "null",
    ) as unknown;
    if (!value || typeof value !== "object") return null;
    const session = value as Partial<StoredBrowserSession>;
    if (
      session.version !== 1 ||
      typeof session.selectedAssetId !== "string" ||
      typeof session.selectedAssetName !== "string" ||
      !session.scope ||
      typeof session.scope !== "object" ||
      ![
        "all",
        "root",
        "trash",
        "folder",
        "tag",
        "collection",
        "smart",
      ].includes(session.scope.kind)
    ) {
      return null;
    }
    if (
      SCOPED_KINDS.has(session.scope.kind) &&
      !("id" in session.scope && typeof session.scope.id === "string")
    ) {
      return null;
    }
    return session as StoredBrowserSession;
  } catch {
    return null;
  }
}

export function writeBrowserSession(
  libraryId: string,
  session: StoredBrowserSession,
  storage?: BrowserSessionStorage,
): void {
  const store = resolveStorage(storage);
  if (!store) return;
  store.setItem(browserSessionKey(libraryId), JSON.stringify(session));
}

/** Build the payload App persists whenever the selected asset changes. */
export function buildBrowserSessionFromBrowseState(
  state: BrowseStateForSession,
): StoredBrowserSession {
  const scope: StoredBrowserSession["scope"] = state.showTrash
    ? { kind: "trash" }
    : state.activeTagId
      ? {
          kind: "tag",
          id: state.activeTagId,
          name: state.activeTagName,
        }
      : state.activeCollectionId
        ? { kind: "collection", id: state.activeCollectionId }
        : state.activeSmartCollectionId
          ? { kind: "smart", id: state.activeSmartCollectionId }
          : state.assetScope === "all" || state.assetScope === "root"
            ? { kind: state.assetScope }
            : { kind: "folder", id: state.assetScope };

  return {
    version: 1,
    scope,
    selectedAssetId: state.selectedAssetId,
    selectedAssetName: state.selectedAssetName,
  };
}
