import type {
  AssetSummary,
  BrowseLayoutEntry,
  TrashedFolderSummary,
} from "../shared/asset-types";
import type { WorkspaceNavLocation } from "./workspace-nav-history";

export interface WorkspaceBrowsePageDescriptor {
  readonly sessionId: string | null;
  readonly offset: number;
  readonly pageSize: number;
  readonly scopeKey: string;
  readonly queryKey: string | null;
}

export interface WorkspaceVirtualLayoutSnapshot {
  readonly total: number;
  readonly geometryRevision: number;
  readonly geometryEntries: readonly (readonly [number, BrowseLayoutEntry])[];
  readonly assetIdsByIndex: readonly (readonly [number, string])[];
  readonly entries: readonly (readonly [number, BrowseLayoutEntry])[];
  readonly indexByAssetId: readonly (readonly [string, number])[];
}

export type WorkspaceRenderSnapshot =
  | {
      readonly kind: "browse";
      readonly location: WorkspaceNavLocation;
      readonly items: readonly AssetSummary[];
      readonly layout: readonly BrowseLayoutEntry[];
      readonly virtualLayout: WorkspaceVirtualLayoutSnapshot | null;
      readonly total: number;
      readonly snippets: readonly (readonly [string, string])[];
      readonly pageDescriptor: WorkspaceBrowsePageDescriptor;
    }
  | {
      readonly kind: "trash";
      readonly location: Extract<WorkspaceNavLocation, { kind: "trash" }>;
      readonly items: readonly AssetSummary[];
      readonly folders: readonly TrashedFolderSummary[];
      readonly layout: readonly BrowseLayoutEntry[];
      readonly virtualLayout: WorkspaceVirtualLayoutSnapshot | null;
      readonly total: number;
      readonly pageDescriptor: WorkspaceBrowsePageDescriptor;
    }
  | {
      readonly kind: "tag-management";
      readonly location: Extract<WorkspaceNavLocation, { kind: "tag-management" }>;
    }
  | {
      readonly kind: "plugin-sidebar";
      readonly location: Extract<WorkspaceNavLocation, { kind: "plugin-sidebar" }>;
    };

export interface WorkspaceRenderSnapshotCacheOptions {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly maxBytesPerEntry?: number;
  readonly maxItemsPerEntry?: number;
  readonly maxLayoutEntriesPerEntry?: number;
}

export interface WorkspaceRenderSnapshotCache {
  readonly libraryId: string | null;
  activateLibrary(libraryId: string | null): void;
  get(tabId: string): WorkspaceRenderSnapshot | null;
  set(tabId: string, snapshot: WorkspaceRenderSnapshot): boolean;
  delete(tabId: string): void;
  clear(): void;
}

interface CacheEntry {
  readonly snapshot: WorkspaceRenderSnapshot;
  readonly estimatedBytes: number;
}

const DEFAULT_MAX_ENTRIES = 8;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_BYTES_PER_ENTRY = 2 * 1024 * 1024;
const DEFAULT_MAX_ITEMS_PER_ENTRY = 320;
const DEFAULT_MAX_LAYOUT_ENTRIES_PER_ENTRY = 1_200;
const MAX_SNIPPETS_PER_ENTRY = 320;
const MAX_TRASH_FOLDERS_PER_ENTRY = 400;
const MAX_SERIALIZED_NODES = 50_000;

function freezeTree<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    freezeTree(child);
  }
  return Object.freeze(value);
}

/** Clones only plain structured data and calculates a conservative size bound. */
function cloneBoundedData(value: unknown): { value: unknown; bytes: number } | null {
  let visitedNodes = 0;
  const ancestors = new Set<object>();

  const visit = (current: unknown): { value: unknown; bytes: number } | null => {
    visitedNodes += 1;
    if (visitedNodes > MAX_SERIALIZED_NODES) return null;
    if (current === null) return { value: null, bytes: 4 };
    if (typeof current === "string") {
      const bytes = current.length * 2;
      return bytes > DEFAULT_MAX_BYTES ? null : { value: current, bytes };
    }
    if (typeof current === "boolean") return { value: current, bytes: 5 };
    if (typeof current === "number") {
      return Number.isFinite(current) ? { value: current, bytes: 8 } : null;
    }
    if (typeof current !== "object") return null;
    if (
      (typeof Blob !== "undefined" && current instanceof Blob) ||
      current instanceof ArrayBuffer ||
      ArrayBuffer.isView(current)
    ) {
      return null;
    }
    if (ancestors.has(current)) return null;
    ancestors.add(current);

    let bytes = 2;
    let clone: unknown;
    if (Array.isArray(current)) {
      if (current.length > MAX_SERIALIZED_NODES) {
        ancestors.delete(current);
        return null;
      }
      const items: unknown[] = [];
      for (const item of current) {
        const child = visit(item);
        if (!child) {
          ancestors.delete(current);
          return null;
        }
        items.push(child.value);
        bytes += child.bytes + 1;
      }
      clone = items;
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        ancestors.delete(current);
        return null;
      }
      const record: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(current)) {
        const child = visit(item);
        if (!child) {
          ancestors.delete(current);
          return null;
        }
        record[key] = child.value;
        bytes += key.length * 2 + child.bytes + 3;
        if (bytes > DEFAULT_MAX_BYTES) {
          ancestors.delete(current);
          return null;
        }
      }
      clone = record;
    }
    ancestors.delete(current);
    return bytes <= DEFAULT_MAX_BYTES ? { value: clone, bytes } : null;
  };

  return visit(value);
}

function snapshotFitsCollectionBounds(
  snapshot: WorkspaceRenderSnapshot,
  maxItems: number,
  maxLayoutEntries: number,
): boolean {
  if (snapshot.kind === "tag-management" || snapshot.kind === "plugin-sidebar") {
    return true;
  }
  const virtualLayoutEntries = snapshot.virtualLayout
    ? snapshot.virtualLayout.geometryEntries.length +
      snapshot.virtualLayout.assetIdsByIndex.length +
      snapshot.virtualLayout.entries.length +
      snapshot.virtualLayout.indexByAssetId.length
    : 0;
  if (
    snapshot.items.length > maxItems ||
    snapshot.layout.length + virtualLayoutEntries > maxLayoutEntries ||
    !Number.isSafeInteger(snapshot.total) ||
    snapshot.total < 0 ||
    !Number.isSafeInteger(snapshot.pageDescriptor.offset) ||
    snapshot.pageDescriptor.offset < 0 ||
    !Number.isSafeInteger(snapshot.pageDescriptor.pageSize) ||
    snapshot.pageDescriptor.pageSize < 0
  ) {
    return false;
  }
  if (
    snapshot.virtualLayout &&
    (!Number.isSafeInteger(snapshot.virtualLayout.total) ||
      snapshot.virtualLayout.total < 0 ||
      !Number.isSafeInteger(snapshot.virtualLayout.geometryRevision) ||
      snapshot.virtualLayout.geometryRevision < 0)
  ) {
    return false;
  }
  if (snapshot.kind === "browse") {
    return snapshot.snippets.length <= MAX_SNIPPETS_PER_ENTRY;
  }
  return (
    snapshot.folders.length <= MAX_TRASH_FOLDERS_PER_ENTRY &&
    snapshot.items.length <= maxItems
  );
}

export function createWorkspaceRenderSnapshotCache(
  options: WorkspaceRenderSnapshotCacheOptions = {},
): WorkspaceRenderSnapshotCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxBytesPerEntry = options.maxBytesPerEntry ?? DEFAULT_MAX_BYTES_PER_ENTRY;
  const maxItems = options.maxItemsPerEntry ?? DEFAULT_MAX_ITEMS_PER_ENTRY;
  const maxLayoutEntries =
    options.maxLayoutEntriesPerEntry ?? DEFAULT_MAX_LAYOUT_ENTRIES_PER_ENTRY;
  if (
    !Number.isInteger(maxEntries) || maxEntries < 1 ||
    !Number.isInteger(maxBytes) || maxBytes < 1 ||
    !Number.isInteger(maxBytesPerEntry) || maxBytesPerEntry < 1 ||
    !Number.isInteger(maxItems) || maxItems < 0 ||
    !Number.isInteger(maxLayoutEntries) || maxLayoutEntries < 0
  ) {
    throw new Error("Workspace render cache limits must be non-negative integers");
  }

  let libraryId: string | null = null;
  const entries = new Map<string, CacheEntry>();
  let totalBytes = 0;

  const clear = () => {
    entries.clear();
    totalBytes = 0;
  };

  return {
    get libraryId() {
      return libraryId;
    },
    activateLibrary(nextLibraryId) {
      if (nextLibraryId === libraryId) return;
      clear();
      libraryId = nextLibraryId;
    },
    get(tabId) {
      const entry = entries.get(tabId);
      if (!entry) return null;
      entries.delete(tabId);
      entries.set(tabId, entry);
      return entry.snapshot;
    },
    set(tabId, snapshot) {
      if (libraryId === null || tabId.length === 0) return false;
      if (!snapshotFitsCollectionBounds(snapshot, maxItems, maxLayoutEntries)) {
        return false;
      }
      const cloned = cloneBoundedData(snapshot);
      if (!cloned || cloned.bytes > maxBytesPerEntry || cloned.bytes > maxBytes) {
        return false;
      }
      const immutableSnapshot = freezeTree(cloned.value) as WorkspaceRenderSnapshot;
      const old = entries.get(tabId);
      if (old) {
        entries.delete(tabId);
        totalBytes -= old.estimatedBytes;
      }
      while (
        entries.size >= maxEntries ||
        totalBytes + cloned.bytes > maxBytes
      ) {
        const oldestKey = entries.keys().next().value as string | undefined;
        if (oldestKey === undefined) break;
        const evicted = entries.get(oldestKey)!;
        entries.delete(oldestKey);
        totalBytes -= evicted.estimatedBytes;
      }
      entries.set(tabId, { snapshot: immutableSnapshot, estimatedBytes: cloned.bytes });
      totalBytes += cloned.bytes;
      return true;
    },
    delete(tabId) {
      const entry = entries.get(tabId);
      if (!entry) return;
      entries.delete(tabId);
      totalBytes -= entry.estimatedBytes;
    },
    clear,
  };
}
