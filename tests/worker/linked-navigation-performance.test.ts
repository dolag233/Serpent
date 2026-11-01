import { mkdirSync, mkdtempSync, rmSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { expect, it } from 'vitest';

import { LibraryService, openConfiguredDatabase } from '../../src/worker/library-service';
import { LinkedDirectoryIndex } from '../../src/worker/linked-directory-index';

/** Metadata-scale benchmark; real media decoding is verified separately. */
it.skipIf(process.env.SERPENT_LINKED_NAV_BENCHMARK !== '1')('records 150k linked-asset navigation and event-loop latency', async () => {
  const workspace = process.cwd();
  const disk = statfsSync(workspace);
  if (disk.bavail * disk.bsize < 2 * 1024 ** 3) throw new Error('Insufficient space for metadata benchmark.');
  const root = mkdtempSync(path.join(workspace, 'tmp', 'issue75-nav-'));
  let navigationStages: unknown;
  const service = new LibraryService({
    observerFactory: () => ({ close() {} }),
    onDiagnostic: (diagnostic) => {
      if (diagnostic.scope === 'navigation.summary') navigationStages = diagnostic.context?.stagesMs;
    },
  });
  let database: ReturnType<typeof openConfiguredDatabase> | undefined;
  try {
    const sourceRoot = path.join(root, 'linked');
    mkdirSync(sourceRoot);
    const library = service.createLibrary({ displayName: 'LinkedBenchmark', selectedParentPath: root });
    const linked = service.importFolderAsLinked({ libraryId: library.libraryId, sourceRootPath: sourceRoot });
    database = openConfiguredDatabase(path.join(library.libraryPath, '.serpent', 'library.db'));
    const connection = database;
    connection.transaction(() => {
      connection.exec(`
        CREATE TEMP TABLE fixture_assets(n INTEGER PRIMARY KEY, asset_id TEXT UNIQUE, revision_id TEXT, relative_path TEXT);
        WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n + 1 FROM numbers WHERE n < 150000)
        INSERT INTO fixture_assets
          SELECT n, '75000000-0000-4000-8000-' || printf('%012d', n),
                    '75000001-0000-4000-8000-' || printf('%012d', n),
                    'group-' || (n % 100) || '/depth/image-' || n || '.png' FROM numbers;
      `);
      connection.prepare(`
        INSERT INTO assets(asset_id, location_kind, linked_folder_id, relative_file_path,
                           path_identity, current_revision_id, availability, created_at, updated_at)
        SELECT asset_id, 'linked', ?, relative_path, relative_path, NULL, 'available',
               '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z' FROM fixture_assets
      `).run(linked.folderId);
      connection.exec(`
        INSERT INTO revisions(revision_id, asset_id, byte_size, modified_at, original_filename, origin, accepted_at)
        SELECT revision_id, asset_id, 16, '2000-01-01T00:00:00.000Z', 'image-' || n || '.png', 'import',
               '2000-01-01T00:00:00.000Z' FROM fixture_assets;
        UPDATE assets SET current_revision_id = (SELECT revision_id FROM fixture_assets WHERE fixture_assets.asset_id = assets.asset_id)
          WHERE location_kind = 'linked';
        DROP TABLE fixture_assets;
      `);
    })();
    const index = new LinkedDirectoryIndex(() => connection);
    index.replace(linked.folderId, Array.from({ length: 4_100 }, (_, n) => `empty-${n}`));
    const gaps: number[] = [];
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      gaps.push(Math.max(0, now - previous - 5));
      previous = now;
    }, 5);
    const started = performance.now();
    let coldMs: number;
    try {
      const results = await Promise.all([
        service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId }),
        service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId }),
      ]);
      coldMs = performance.now() - started;
      expect(results[0]).toBe(results[1]);
      expect(results[0].allAssetCount).toBe(150_000);
      expect(results[0].linkedFolders).toHaveLength(4_301);
    } finally {
      clearInterval(timer);
    }
    const warm: number[] = [];
    for (let sample = 0; sample < 7; sample += 1) {
      const began = performance.now();
      await service.getLibraryNavigationSummaryAsync({ libraryId: library.libraryId });
      warm.push(performance.now() - began);
    }
    warm.sort((a, b) => a - b);
    console.log('linked navigation metadata benchmark:', JSON.stringify({
      assets: 150_000,
      emptyDirectories: 4_100,
      coldPairMs: Math.round(coldMs!),
      warmP50Ms: Math.round(warm[3]!),
      warmP95Ms: Math.round(warm[6]!),
      maxEventLoopGapMs: Math.round(Math.max(...gaps, 0)),
      navigationStages,
    }));
  } finally {
    database?.close();
    service.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
