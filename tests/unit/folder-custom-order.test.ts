import { describe, expect, it, vi } from "vitest";

import {
  applyFolderSiblingOrder,
  mergeImportedFolderOrder,
  importFolderCustomOrder,
  FOLDER_CUSTOM_ORDER_CHANGED,
  customOrderKey,
  insertBesideSibling,
  loadCollectionCustomOrder,
  loadFolderCustomOrder,
  moveFolderInCustomOrder,
  parseFolderCustomOrder,
  saveCollectionCustomOrder,
  saveFolderCustomOrder,
} from "../../src/renderer/folder-custom-order";
import {
  buildUnifiedDirectoryNavEntries,
  sortCollectionTree,
  sortManagedTreeEntries,
} from "../../src/renderer/unified-directory-nav";
import type {
  CollectionSummary,
  ManagedFolderSummary,
} from "../../src/shared/asset-types";

describe("imported folder order", () => {
  it("persists migrated positions and notifies the current sidebar", () => {
    const storage = memoryStorage();
    const events = new EventTarget();
    const listener = vi.fn();
    events.addEventListener(FOLDER_CUSTOM_ORDER_CHANGED, listener);
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", events);
    try {
      importFolderCustomOrder("target", [
        { folderId: "z", parentFolderId: null, position: 0 },
        { folderId: "a", parentFolderId: null, position: 1 },
      ]);
      const saved = loadFolderCustomOrder("target");
      expect(saved.get(customOrderKey(null, "z"))).toBe(0);
      expect(saved.get(customOrderKey(null, "a"))).toBe(1);
      expect(loadFolderCustomOrder("another").size).toBe(0);
      expect(listener).toHaveBeenCalledOnce();
      expect((listener.mock.calls[0]![0] as CustomEvent<string>).detail).toBe("target");
    } finally { vi.unstubAllGlobals(); }
  });
  it("seeds root and child order while preserving existing sibling arrangements", () => {
    const existing = new Map([[customOrderKey(null, "manual"), 5], [customOrderKey("parent", "a"), 3]]);
    const next = mergeImportedFolderOrder(existing, [
      { folderId: "z", parentFolderId: null, position: 0 },
      { folderId: "b", parentFolderId: "other", position: 0 },
      { folderId: "c", parentFolderId: "other", position: 1 },
      { folderId: "a", parentFolderId: "parent", position: 0 },
      { folderId: "d", parentFolderId: "parent", position: 1 },
    ]);
    expect(next.get(customOrderKey(null, "manual"))).toBe(5);
    expect(next.get(customOrderKey(null, "z"))).toBe(0);
    expect(next.get(customOrderKey("other", "c"))).toBe(1);
    expect(next.get(customOrderKey("parent", "a"))).toBe(3);
    expect(next.has(customOrderKey("parent", "d"))).toBe(false);
    expect(existing.size).toBe(2);
  });
});

const folder = (
  folderId: string,
  name: string,
  parentFolderId: string | null = null,
): ManagedFolderSummary => ({
  folderId,
  parentFolderId,
  name,
  relativePath: parentFolderId ? `${parentFolderId}/${name}` : name,
  directAssetCount: 0,
  childFolderCount: 0,
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    map,
  };
}

const collection = (
  collectionId: string,
  name: string,
  parentId: string | null = null,
): CollectionSummary => ({
  collectionId,
  parentId,
  name,
  description: null,
  coverAssetId: null,
  position: 0,
  assetCount: 0,
  childCollectionCount: 0,
});

describe("folder custom order storage", () => {
  it("round-trips positions per library", () => {
    const storage = memoryStorage();
    saveFolderCustomOrder("library-a", new Map([["f2", 0], ["f1", 1]]), storage);
    saveFolderCustomOrder("library-b", new Map([["f9", 0]]), storage);

    expect([...loadFolderCustomOrder("library-a", storage)]).toEqual([["f2", 0], ["f1", 1]]);
    expect([...loadFolderCustomOrder("library-b", storage)]).toEqual([["f9", 0]]);
    expect(loadFolderCustomOrder("library-c", storage).size).toBe(0);
  });

  it("keeps collection positions in their own per-library namespace", () => {
    const storage = memoryStorage();
    saveCollectionCustomOrder("library-a", new Map([["c2", 0], ["c1", 1]]), storage);
    saveFolderCustomOrder("library-a", new Map([["f1", 0]]), storage);

    expect([...loadCollectionCustomOrder("library-a", storage)]).toEqual([
      ["c2", 0],
      ["c1", 1],
    ]);
    expect([...loadFolderCustomOrder("library-a", storage)]).toEqual([["f1", 0]]);
    expect(loadCollectionCustomOrder("library-b", storage).size).toBe(0);
  });

  it("ignores malformed or non-numeric entries", () => {
    expect(parseFolderCustomOrder("not json").size).toBe(0);
    expect(parseFolderCustomOrder("[]").size).toBe(0);
    expect([...parseFolderCustomOrder('{"a":1,"b":"x","":3,"c":null}')]).toEqual([["a", 1]]);
  });
});

describe("moveFolderInCustomOrder", () => {
  const siblings = ["a", "b", "c", "d"];

  it("inserts before or after the hovered sibling", () => {
    expect(moveFolderInCustomOrder(siblings, ["d"], "b", "before")).toEqual([
      "a", "d", "b", "c",
    ]);
    expect(moveFolderInCustomOrder(siblings, ["a"], "c", "after")).toEqual([
      "b", "c", "a", "d",
    ]);
  });

  it("keeps the relative order of a multi-folder drag", () => {
    expect(moveFolderInCustomOrder(siblings, ["b", "d"], "a", "after")).toEqual([
      "a", "b", "d", "c",
    ]);
  });

  it("is a no-op when the target is part of the drag", () => {
    expect(moveFolderInCustomOrder(siblings, ["b"], "b", "after")).toEqual(siblings);
  });
});

describe("insertBesideSibling", () => {
  it("places a row from another parent beside the hovered sibling", () => {
    expect(insertBesideSibling(["a", "b"], ["x"], "b", "before")).toEqual([
      "a", "x", "b",
    ]);
    expect(insertBesideSibling(["a", "b"], ["x"], "a", "after")).toEqual([
      "a", "x", "b",
    ]);
  });

  it("keeps multi-row drags in their source order across levels", () => {
    expect(
      insertBesideSibling(["a", "b", "c"], ["y", "x"], "a", "before"),
    ).toEqual(["y", "x", "a", "b", "c"]);
  });
});

describe("applyFolderSiblingOrder", () => {
  it("rewrites only the reordered siblings in that parent scope", () => {
    const next = applyFolderSiblingOrder(
      new Map([["other", 7], [customOrderKey("parent", "a"), 0]]),
      "parent",
      ["b", "a"],
    );
    expect(next.get(customOrderKey("parent", "b"))).toBe(0);
    expect(next.get(customOrderKey("parent", "a"))).toBe(1);
    expect(next.get("b")).toBeUndefined();
    expect(next.get("other")).toBe(7);
  });
});

describe("custom folder sort", () => {
  const entries = buildUnifiedDirectoryNavEntries(
    [folder("a", "Alpha"), folder("b", "Beta"), folder("c", "Gamma")],
    [],
  );

  it("orders siblings by stored position and trails unlisted folders by name", () => {
    const sorted = sortManagedTreeEntries(
      entries,
      "custom",
      "asc",
      new Map([["c", 0], ["a", 1]]),
    );
    expect(sorted.map((entry) => entry.folderId)).toEqual(["c", "a", "b"]);
  });

  it("ignores the asc/desc switch because the order is the preference", () => {
    const order = new Map([["c", 0], ["a", 1]]);
    expect(
      sortManagedTreeEntries(entries, "custom", "desc", order).map(
        (entry) => entry.folderId,
      ),
    ).toEqual(["c", "a", "b"]);
  });

  it("keeps nested siblings in their own group", () => {
    const nested = buildUnifiedDirectoryNavEntries(
      [folder("p", "Parent"), folder("x", "X", "p"), folder("y", "Y", "p")],
      [],
    );
    const sorted = sortManagedTreeEntries(
      nested,
      "custom",
      "asc",
      new Map([["y", 0], ["x", 1]]),
    );
    expect(sorted.map((entry) => entry.folderId)).toEqual(["p", "y", "x"]);
  });
});


describe("custom collection sort", () => {
  const tree = new Map<string | null, CollectionSummary[]>([
    [null, [collection("a", "Alpha"), collection("b", "Beta")]],
    ["a", [collection("x", "X", "a"), collection("y", "Y", "a")]],
  ]);

  it("orders each collection level by stored position", () => {
    const sorted = sortCollectionTree(
      tree,
      "custom",
      "asc",
      new Map([["b", 0], ["a", 1], ["y", 0], ["x", 1]]),
    );
    expect(sorted.get(null)?.map((entry) => entry.collectionId)).toEqual([
      "b",
      "a",
    ]);
    expect(sorted.get("a")?.map((entry) => entry.collectionId)).toEqual([
      "y",
      "x",
    ]);
  });

  it("trails collections that were never reordered by name", () => {
    const sorted = sortCollectionTree(
      tree,
      "custom",
      "asc",
      new Map([["b", 0]]),
    );
    expect(sorted.get(null)?.map((entry) => entry.collectionId)).toEqual([
      "b",
      "a",
    ]);
  });
});

describe("parent-scoped custom positions", () => {
  it("does not let a destination position reorder the old parent", () => {
    const beforeMove = buildUnifiedDirectoryNavEntries(
      [
        folder("parent-a", "A"),
        folder("parent-b", "B"),
        folder("moved", "Moved", "parent-a"),
        folder("a2", "A2", "parent-a"),
        folder("b1", "B1", "parent-b"),
        folder("b2", "B2", "parent-b"),
      ],
      [],
    );
    // While the move is in flight the row still lives under parent-a. Its new
    // position belongs to parent-b and must not affect parent-a's order.
    const order = new Map([
      [customOrderKey("parent-a", "a2"), 0],
      [customOrderKey("parent-a", "moved"), 1],
      [customOrderKey("parent-b", "moved"), 0],
      [customOrderKey("parent-b", "b2"), 1],
      [customOrderKey("parent-b", "b1"), 2],
    ]);
    expect(
      sortManagedTreeEntries(beforeMove, "custom", "asc", order).map(
        (entry) => entry.folderId,
      ),
    ).toEqual(["parent-a", "a2", "moved", "parent-b", "b2", "b1"]);

    const afterMove = buildUnifiedDirectoryNavEntries(
      [
        folder("parent-a", "A"),
        folder("parent-b", "B"),
        folder("moved", "Moved", "parent-b"),
        folder("a2", "A2", "parent-a"),
        folder("b1", "B1", "parent-b"),
        folder("b2", "B2", "parent-b"),
      ],
      [],
    );
    expect(
      sortManagedTreeEntries(afterMove, "custom", "asc", order).map(
        (entry) => entry.folderId,
      ),
    ).toEqual(["parent-a", "a2", "parent-b", "moved", "b2", "b1"]);
  });

  it("prefers a scoped position over the legacy flat value", () => {
    const entries = buildUnifiedDirectoryNavEntries(
      [folder("a", "Alpha"), folder("b", "Beta")],
      [],
    );
    const sorted = sortManagedTreeEntries(
      entries,
      "custom",
      "asc",
      new Map([
        ["a", 0],
        ["b", 1],
        [customOrderKey(null, "a"), 5],
        [customOrderKey(null, "b"), 4],
      ]),
    );
    expect(sorted.map((entry) => entry.folderId)).toEqual(["b", "a"]);
  });
});
