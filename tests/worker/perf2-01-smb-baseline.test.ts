import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { afterEach, describe, expect, it } from "vitest";

import { summarizeTimingSamples } from "../../src/shared/performance-contract";
import { LibraryService } from "../../src/worker/library-service";

const smbRoot = process.env.SERPENT_PERF_SMB_ROOT?.trim();
const describeSmb = smbRoot ? describe : describe.skip;

const temporaryRoots: string[] = [];
const services: LibraryService[] = [];

function newService(): LibraryService {
  const service = new LibraryService({
    observerFactory: () => ({ close() {} }),
  });
  services.push(service);
  return service;
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
    expect(existsSync(root), "PERF2-01 SMB fixture must not leave a residual directory").toBe(false);
  }
});

describeSmb("PERF2-01 optional SMB persist baseline", () => {
  it("times library and folder persist without recording the mount path", () => {
    const parent = smbRoot ?? tmpdir();
    const root = mkdtempSync(path.join(parent, "serpent-p201-"));
    temporaryRoots.push(root);
    const service = newService();

    const createStartedAt = performance.now();
    const library = service.createLibrary({
      displayName: "PERF2-01 SMB baseline",
      selectedParentPath: root,
    });
    const createMs = performance.now() - createStartedAt;

    const folderSamples: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const startedAt = performance.now();
      service.createManagedFolder({
        libraryId: library.libraryId,
        name: `Folder ${index}`,
      });
      folderSamples.push(performance.now() - startedAt);
    }

    const browseStartedAt = performance.now();
    const page = service.searchAssets({
      libraryId: library.libraryId,
      limit: 50,
      offset: 0,
    });
    const browseMs = performance.now() - browseStartedAt;
    service.closeAll();

    console.info("[perf2-01-smb]", JSON.stringify({
      phase: "persist",
      createLibraryMs: Number(createMs.toFixed(1)),
      folderCreate: summarizeTimingSamples(folderSamples),
      searchAssetsMs: Number(browseMs.toFixed(1)),
      liveAssetCount: page.total,
    }));
    expect(page.total).toBe(0);
    expect(createMs).toBeGreaterThan(0);
  });
});
