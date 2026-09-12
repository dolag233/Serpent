import { describe, expect, it } from "vitest";

import {
  createWorkspaceRenderSnapshotCache,
  type WorkspaceRenderSnapshot,
} from "../../src/renderer/workspace-render-snapshot-cache";

function browseSnapshot(label = "all"): WorkspaceRenderSnapshot {
  return {
    kind: "browse",
    location: { kind: "all" },
    items: [],
    layout: [],
    virtualLayout: null,
    total: 0,
    snippets: [],
    pageDescriptor: {
      sessionId: null,
      offset: 0,
      pageSize: 80,
      scopeKey: label,
      queryKey: null,
    },
  };
}

function pageDescriptor(snapshot: WorkspaceRenderSnapshot) {
  if (snapshot.kind !== "browse") throw new Error("Expected a browse snapshot");
  return snapshot.pageDescriptor;
}

describe("workspace render snapshot cache", () => {
  it("isolates snapshots by tab and removes them when a tab closes", () => {
    const cache = createWorkspaceRenderSnapshotCache();
    cache.activateLibrary("library-a");
    expect(cache.set("tab-a", browseSnapshot("folder-a"))).toBe(true);
    expect(cache.set("tab-b", browseSnapshot("folder-b"))).toBe(true);

    expect(pageDescriptor(cache.get("tab-a")!).scopeKey).toBe("folder-a");
    expect(pageDescriptor(cache.get("tab-b")!).scopeKey).toBe("folder-b");
    cache.delete("tab-a");
    expect(cache.get("tab-a")).toBeNull();
    expect(cache.get("tab-b")).not.toBeNull();
  });

  it("clears every snapshot when the active library changes or closes", () => {
    const cache = createWorkspaceRenderSnapshotCache();
    cache.activateLibrary("library-a");
    cache.set("tab-a", browseSnapshot());

    cache.activateLibrary("library-b");
    expect(cache.get("tab-a")).toBeNull();
    expect(cache.set("tab-b", browseSnapshot())).toBe(true);

    cache.activateLibrary(null);
    expect(cache.libraryId).toBeNull();
    expect(cache.get("tab-b")).toBeNull();
    expect(cache.set("tab-b", browseSnapshot())).toBe(false);
  });

  it("uses LRU eviction to enforce the configured entry limit", () => {
    const cache = createWorkspaceRenderSnapshotCache({ maxEntries: 2 });
    cache.activateLibrary("library-a");
    cache.set("tab-a", browseSnapshot("a"));
    cache.set("tab-b", browseSnapshot("b"));
    cache.get("tab-a");
    cache.set("tab-c", browseSnapshot("c"));

    expect(cache.get("tab-a")).not.toBeNull();
    expect(cache.get("tab-b")).toBeNull();
    expect(cache.get("tab-c")).not.toBeNull();
  });

  it("rejects unbounded render arrays and snapshots beyond the byte budget", () => {
    const cache = createWorkspaceRenderSnapshotCache({
      maxItemsPerEntry: 1,
      maxBytesPerEntry: 128,
    });
    cache.activateLibrary("library-a");
    const tooManyItems = {
      ...browseSnapshot(),
      items: [{ assetId: "one" }, { assetId: "two" }],
    } as unknown as WorkspaceRenderSnapshot;
    const tooLarge = {
      ...browseSnapshot(),
      pageDescriptor: {
        sessionId: null,
        offset: 0,
        pageSize: 80,
        scopeKey: "x".repeat(256),
        queryKey: null,
      },
    } as WorkspaceRenderSnapshot;

    expect(cache.set("many", tooManyItems)).toBe(false);
    expect(cache.set("large", tooLarge)).toBe(false);
    expect(cache.get("many")).toBeNull();
    expect(cache.get("large")).toBeNull();
  });

  it("rejects media payloads, typed arrays, and circular structures", () => {
    const cache = createWorkspaceRenderSnapshotCache();
    cache.activateLibrary("library-a");
    const withBlob = {
      ...browseSnapshot(),
      unexpected: new Blob(["image bytes"]),
    } as unknown as WorkspaceRenderSnapshot;
    const withPixels = {
      ...browseSnapshot(),
      unexpected: new Uint8Array([1, 2, 3]),
    } as unknown as WorkspaceRenderSnapshot;
    const circular: Record<string, unknown> = { ...browseSnapshot() };
    circular.self = circular;

    expect(cache.set("blob", withBlob)).toBe(false);
    expect(cache.set("pixels", withPixels)).toBe(false);
    expect(cache.set("cycle", circular as unknown as WorkspaceRenderSnapshot)).toBe(false);
  });

  it("returns immutable copies so render state cannot mutate the stored snapshot", () => {
    const cache = createWorkspaceRenderSnapshotCache();
    cache.activateLibrary("library-a");
    const snapshot = browseSnapshot();
    cache.set("tab-a", snapshot);
    const cached = cache.get("tab-a")!;

    expect(Object.isFrozen(cached)).toBe(true);
    expect(Object.isFrozen(pageDescriptor(cached))).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(false);
  });
});
