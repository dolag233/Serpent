import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LibraryService } from "../../src/worker/library-service";
import type { LargeLibraryFixtureManifest } from "./large-library-fixture";

const fixturePath = process.env.SERPENT_LARGE_LIBRARY_PERF_PATH;
const configuredOffset = Number(process.env.SERPENT_LARGE_LIBRARY_PERF_OFFSET ?? 1_100);
const benchmarkOffset = Number.isFinite(configuredOffset)
  ? Math.max(0, Math.trunc(configuredOffset))
  : 1_100;
let temporaryRoot = "";
let temporaryLibraryPath = "";
let manifest: LargeLibraryFixtureManifest;
let service: LibraryService;
const require = createRequire(import.meta.url);
const TestDatabase = require("better-sqlite3") as new (filename: string) => {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): {
    all(...parameters: unknown[]): unknown[];
    run(...parameters: unknown[]): { changes: number };
  };
};

function removeSelectedThumbnails(assetIds: readonly string[]): number {
  if (assetIds.length === 0) return 0;
  const database = new TestDatabase(
    path.join(temporaryLibraryPath, ".serpent", "library.db"),
  );
  const placeholders = assetIds.map(() => "?").join(",");
  const rows = database.prepare(
    `SELECT ra.artifact_id, ra.file_path
       FROM revision_artifacts ra
       JOIN assets a ON a.current_revision_id = ra.revision_id
      WHERE a.asset_id IN (${placeholders})
        AND ra.kind = 'thumbnail'`,
  ).all(...assetIds) as Array<{
    artifact_id: string;
    file_path: string;
  }>;
  const deleteArtifact = database.prepare(
    "DELETE FROM revision_artifacts WHERE artifact_id = ?",
  );
  const artifactsDir = path.join(temporaryLibraryPath, ".serpent", "artifacts");
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      rmSync(path.join(artifactsDir, row.file_path), { force: true });
      deleteArtifact.run(row.artifact_id);
    }
    database.exec("COMMIT");
    return rows.length;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

describe.skipIf(!fixturePath)("10k visible-thumbnail generation benchmark", () => {
  beforeAll(() => {
    if (!fixturePath) throw new Error("Missing large-library fixture path.");
    const manifestPath = path.join(
      fixturePath,
      ".serpent",
      "large-library-fixture.json",
    );
    if (!existsSync(manifestPath)) {
      throw new Error(`Missing fixture manifest: ${manifestPath}`);
    }
    manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as LargeLibraryFixtureManifest;
    temporaryRoot = mkdtempSync(
      path.join(tmpdir(), "serpent-visible-thumbnail-benchmark-"),
    );
    temporaryLibraryPath = path.join(temporaryRoot, "library");
    execFileSync("cp", ["-cR", fixturePath, temporaryLibraryPath]);
    service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    service.openLibrary(temporaryLibraryPath);
  }, 120_000);

  afterAll(() => {
    service?.closeAll();
    if (temporaryRoot) {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
  });

  it("records direct generation cost for one fourth-stop viewport", async () => {
    const page = service.searchAssets({
      libraryId: manifest.libraryId,
      limit: 30,
      offset: benchmarkOffset,
    });
    expect(page.items).toHaveLength(30);
    const assetIds = page.items.map((asset) => asset.assetId);
    // The shared fixture is intentionally warm for the Electron decode
    // benchmark. Make this isolated clone cold for the same viewport so this
    // suite measures actual Worker generation rather than job deduplication.
    service.closeAll();
    expect(removeSelectedThumbnails(assetIds)).toBe(assetIds.length);
    service.openLibrary(temporaryLibraryPath);
    const selectedQueuedJobs = service.listMediaJobs(manifest.libraryId).jobs
      .filter((job) =>
        assetIds.includes(job.assetId)
        && job.kind === "generate_thumbnail"
        && job.status === "queued",
      )
      .map((job) => job.jobId);
    if (selectedQueuedJobs.length > 0) {
      service.cancelMediaJobs(manifest.libraryId, selectedQueuedJobs);
    }
    // Re-read the cold page after removing its terminal artifacts. The warm
    // page above intentionally still contains artifact-backed summaries, so
    // it cannot tell us which native images will be admitted to the derived
    // thumbnail lane versus served source-direct.
    const coldPage = service.searchAssets({
      libraryId: manifest.libraryId,
      limit: assetIds.length,
      offset: benchmarkOffset,
    });
    const generatedAssetIds = coldPage.items
      .filter((asset) => asset.previewKind !== 'source')
      .map((asset) => asset.assetId);
    const enqueued = service.enqueueThumbnailJobs(manifest.libraryId, {
      assetIds,
      limit: assetIds.length,
      priority: 350,
      skipStaleRepair: true,
    });
    expect(enqueued).toBe(generatedAssetIds.length);

    const completed: string[] = [];
    const startedAt = performance.now();
    const processed = await service.processThumbnailQueue(manifest.libraryId, {
      maxJobs: assetIds.length,
      jobKinds: ['generate_thumbnail'],
      onResult: (result) => {
        if (result.artifactId) completed.push(result.assetId);
      },
    });
    const elapsedMs = performance.now() - startedAt;
    console.info(JSON.stringify({
      suite: "large-library-visible-thumbnail-generation",
      assets: manifest.assetCount,
      requested: assetIds.length,
      generated: generatedAssetIds.length,
      sourceDirect: assetIds.length - generatedAssetIds.length,
      processed,
      completed: completed.length,
      elapsedMs: Number(elapsedMs.toFixed(1)),
      throughputPerSecond: Number((completed.length / (elapsedMs / 1_000)).toFixed(1)),
    }));

    expect(processed).toBe(generatedAssetIds.length);
    expect(completed).toHaveLength(generatedAssetIds.length);
  }, 120_000);
});
