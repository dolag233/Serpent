import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LibraryService } from "../../src/worker/library-service";
import type { LargeLibraryFixtureManifest } from "./large-library-fixture";

const fixturePath = process.env.SERPENT_LARGE_LIBRARY_PREWARM_PATH;
const jumpFractions = [
  0.11, 0.83, 0.37, 0.69, 0.22, 0.77, 0.46, 0.61, 0.15, 0.54,
];
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

describe.skipIf(!fixturePath)("prepare persistent thumbnails for Electron loading benchmark", () => {
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
    service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    service.openLibrary(fixturePath);
  }, 120_000);

  afterAll(() => service?.closeAll());

  it("prepares the deterministic random-jump pages without renderer cache", async () => {
    const selectedIds = [
      ...new Set(
        jumpFractions.flatMap((fraction) => {
          const center = Math.round(fraction * Math.max(0, manifest.assetCount - 1));
          const offset = Math.floor(center / 100) * 100;
          return service
            .searchAssets({
              libraryId: manifest.libraryId,
              limit: 100,
              offset,
            })
            .items.map((asset) => asset.assetId);
        }),
      ),
    ];

    // The fixture intentionally reuses a bounded source pool. Once the real
    // product pipeline has generated one thumbnail for a source signature,
    // clone that durable artifact to equivalent revisions. This models a
    // mature 10k library without spending minutes decoding duplicate fixture
    // bytes, while Electron still reads and decodes distinct artifact files.
    let database = new TestDatabase(
      path.join(fixturePath!, ".serpent", "library.db"),
    );
    const artifactsDir = path.join(fixturePath!, ".serpent", "artifacts");
    type ArtifactRow = {
      asset_id: string;
      current_revision_id: string;
      relative_file_path: string;
      source_width: number;
      source_height: number;
      thumbnail_file_path: string | null;
      thumbnail_mime_type: string | null;
      thumbnail_width: number | null;
      thumbnail_height: number | null;
      thumbnail_generator_version: string | null;
    };
    const loadRows = () => database.prepare(
      `SELECT a.asset_id, a.current_revision_id, a.relative_file_path,
              meta.width AS source_width, meta.height AS source_height,
              thumb.file_path AS thumbnail_file_path,
              thumb.mime_type AS thumbnail_mime_type,
              thumb.width AS thumbnail_width, thumb.height AS thumbnail_height,
              thumb.generator_version AS thumbnail_generator_version
         FROM assets a
         JOIN revision_artifacts meta
           ON meta.revision_id = a.current_revision_id
          AND meta.kind = 'extracted_metadata'
          AND meta.status = 'ready'
          AND meta.invalidated_at IS NULL
         LEFT JOIN revision_artifacts thumb
           ON thumb.revision_id = a.current_revision_id
          AND thumb.kind = 'thumbnail'
          AND thumb.status = 'ready'
          AND thumb.invalidated_at IS NULL
        WHERE LOWER(a.relative_file_path) LIKE '%.jpg'
           OR LOWER(a.relative_file_path) LIKE '%.jpeg'
           OR LOWER(a.relative_file_path) LIKE '%.png'
           OR LOWER(a.relative_file_path) LIKE '%.webp'
           OR LOWER(a.relative_file_path) LIKE '%.gif'
           OR LOWER(a.relative_file_path) LIKE '%.tif'
           OR LOWER(a.relative_file_path) LIKE '%.tiff'
        ORDER BY a.relative_file_path`,
    ).all() as ArtifactRow[];
    const keyFor = (row: ArtifactRow) =>
      `${path.extname(row.relative_file_path).toLowerCase()}:${row.source_width}x${row.source_height}`;
    // An interrupted fixture-preparation run may leave benchmark-owned jobs in
    // a terminal state that participates in product deduplication. Remove only
    // those explicitly marked by this helper before generating missing donors.
    const cleanedBacklog = database.prepare(
      `DELETE FROM jobs
        WHERE status = 'cancelled'
          AND error_code = 'BENCHMARK_FIXTURE_QUIESCED'`,
    ).run().changes;
    // Refresh the product connection after direct fixture maintenance; an
    // already-open SQLite reader can otherwise retain the old dedupe snapshot.
    database.close();
    service.closeAll();
    service.openLibrary(fixturePath!);
    database = new TestDatabase(
      path.join(fixturePath!, ".serpent", "library.db"),
    );
    const initialRows = loadRows();
    const donorKeys = new Set(
      initialRows.filter((row) => row.thumbnail_file_path).map(keyFor),
    );
    const representatives = new Map<string, string>();
    for (const row of initialRows) {
      const key = keyFor(row);
      if (!donorKeys.has(key) && !representatives.has(key)) {
        representatives.set(key, row.asset_id);
      }
    }
    const representativeIds = [...representatives.values()];
    const enqueued = representativeIds.length === 0
      ? 0
      : service.enqueueThumbnailJobs(manifest.libraryId, {
          assetIds: representativeIds,
          limit: representativeIds.length,
          priority: 350,
          skipStaleRepair: true,
        });

    let processed = 0;
    let missingDonorKeys = representativeIds.length;
    for (let waveIndex = 0; waveIndex < 5 && missingDonorKeys > 0; waveIndex += 1) {
      const wave = await service.processThumbnailQueue(manifest.libraryId, {
        maxJobs: 100,
      });
      if (wave === 0) break;
      processed += wave;
      const readyKeys = new Set(
        loadRows().filter((row) => row.thumbnail_file_path).map(keyFor),
      );
      missingDonorKeys = [...representatives.keys()].filter(
        (key) => !readyKeys.has(key),
      ).length;
    }

    const rows = loadRows();
    const donors = new Map(
      rows
        .filter((row) => row.thumbnail_file_path)
        .map((row) => [keyFor(row), row] as const),
    );
    const insertArtifact = database.prepare(
      `INSERT INTO revision_artifacts
         (artifact_id, revision_id, kind, mime_type, byte_size, file_path,
          width, height, generator_version, status, generated_at)
       VALUES (?, ?, 'thumbnail', ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    );
    let clonedArtifacts = 0;
    let cancelledBacklog: number;
    let readyThumbnailCount: number;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        if (row.thumbnail_file_path) continue;
        const donor = donors.get(keyFor(row));
        if (!donor?.thumbnail_file_path || !donor.thumbnail_mime_type) continue;
        const extension = path.extname(donor.thumbnail_file_path);
        const artifactId = randomUUID();
        const filePath = `${artifactId}${extension}`;
        copyFileSync(
          path.join(artifactsDir, donor.thumbnail_file_path),
          path.join(artifactsDir, filePath),
        );
        insertArtifact.run(
          artifactId,
          row.current_revision_id,
          donor.thumbnail_mime_type,
          statSync(path.join(artifactsDir, filePath)).size,
          filePath,
          donor.thumbnail_width,
          donor.thumbnail_height,
          donor.thumbnail_generator_version ?? "benchmark-donor",
          new Date().toISOString(),
        );
        clonedArtifacts += 1;
      }
      cancelledBacklog = database.prepare(
        `UPDATE jobs
            SET status = 'cancelled', error_code = 'BENCHMARK_FIXTURE_QUIESCED', updated_at = ?
          WHERE status IN ('queued', 'running')`,
      ).run(new Date().toISOString()).changes;
      readyThumbnailCount = (database.prepare(
        `SELECT COUNT(*) AS count
           FROM revision_artifacts
          WHERE kind = 'thumbnail'
            AND status = 'ready'
            AND invalidated_at IS NULL`,
      ).all()[0] as { count: number }).count;
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }

    console.info(JSON.stringify({
      suite: "large-library-benchmark-prewarm",
      assets: manifest.assetCount,
      selected: selectedIds.length,
      sourceSignatures: new Set(rows.map(keyFor)).size,
      generatedRepresentatives: representativeIds.length,
      cleanedBacklog,
      enqueued,
      processed,
      missingDonorKeys,
      clonedArtifacts,
      cancelledBacklog,
      readyThumbnailCount,
    }));
    expect(missingDonorKeys).toBe(0);
    expect(readyThumbnailCount).toBeGreaterThanOrEqual(manifest.imageCount);
  }, 300_000);
});
