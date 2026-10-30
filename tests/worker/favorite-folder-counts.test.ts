import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

import { LibraryService } from "../../src/worker/library-service";

it("counts every favorite descendant in managed and linked folders and refreshes after metadata changes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "serpent-favorite-counts-"));
  const service = new LibraryService();
  try {
    const library = service.createLibrary({ displayName: "Favorites", selectedParentPath: root });
    const libraryId = library.libraryId;
    const parent = service.createManagedFolder({ libraryId, name: "Parent" });
    const child = service.createManagedFolder({ libraryId, parentFolderId: parent.folderId, name: "Child" });
    const deep = service.createManagedFolder({ libraryId, parentFolderId: child.folderId, name: "Deep" });
    const empty = service.createManagedFolder({ libraryId, parentFolderId: parent.folderId, name: "Empty" });
    const source = path.join(root, "managed.txt");
    writeFileSync(source, "managed favorite");
    const imported = service.prepareOrExecuteImport({
      libraryId, targetFolderId: deep.folderId, sourceKind: "files", sourcePaths: [source],
    });
    if ("importId" in imported) throw new Error("unexpected conflict plan");
    const managed = imported.assets[0]!;

    const linkedRoot = path.join(root, "Linked");
    mkdirSync(path.join(linkedRoot, "Nested", "Deep"), { recursive: true });
    mkdirSync(path.join(linkedRoot, "Empty"), { recursive: true });
    for (let index = 0; index < 205; index++) {
      writeFileSync(path.join(linkedRoot, "Nested", "Deep", `${String(index).padStart(3, "0")}.txt`), `linked ${index}`);
    }
    const linked = service.importFolderAsLinked({ libraryId, sourceRootPath: linkedRoot });
    const linkedAsset = service.listAssets({ libraryId, folderId: linked.folderId, recursive: true })
      .find((asset) => asset.relativeFilePath === "Nested/Deep/204.txt")!;
    expect(linkedAsset).toBeDefined();

    const setFavorite = (assetId: string, favorite: boolean) => service.setAssetMetadata({
      libraryId, assetId, favorite,
      expectedVersion: service.getAssetMetadata({ libraryId, assetId }).entityVersion,
    });
    setFavorite(managed.assetId, true);
    setFavorite(linkedAsset.assetId, true);
    const readCounts = () => service.filteredFolderCounts({
      libraryId, filters: [{ field: "favorite", values: [], exclude: false }],
    });
    const counts = readCounts();
    expect(counts.all).toBe(2);
    expect(counts.folders).toEqual(expect.arrayContaining([
      { folderId: parent.folderId, count: 1 },
      { folderId: child.folderId, count: 1 },
      { folderId: deep.folderId, count: 1 },
      { folderId: linked.folderId, count: 1 },
    ]));
    expect(counts.folders.some((folder) => folder.folderId === empty.folderId)).toBe(false);
    const linkedNested = service.listFolderBrowseEntries({ libraryId, parentFolderId: linked.folderId })
      .find((folder) => folder.name === "Nested")!;
    const linkedDeep = service.listFolderBrowseEntries({ libraryId, parentFolderId: linkedNested.folderId })[0]!;
    expect(counts.folders).toEqual(expect.arrayContaining([
      { folderId: linkedNested.folderId, count: 1 },
      { folderId: linkedDeep.folderId, count: 1 },
    ]));

    setFavorite(linkedAsset.assetId, false);
    expect(readCounts().folders.some((folder) => folder.folderId === linked.folderId)).toBe(false);
    setFavorite(managed.assetId, false);
    expect(readCounts()).toEqual({ all: 0, root: 0, folders: [] });
  } finally {
    service.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});
