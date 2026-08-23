import { lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function collectEventLoopLagDuring<T>(operation: () => Promise<T>): Promise<{
  result: T;
  samples: number[];
  elapsedMs: number;
}> {
  const samples: number[] = [];
  const intervalMs = 5;
  let previous = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    samples.push(Math.max(0, now - previous - intervalMs));
    previous = now;
  }, intervalMs);
  const startedAt = performance.now();
  return operation().then((result) => ({
    result,
    samples,
    elapsedMs: performance.now() - startedAt,
  })).finally(() => clearInterval(timer));
}

describe('open reconciliation performance', () => {
  it('keeps the Worker event loop responsive while discovering managed files', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-reconciliation-perf-'));
    roots.push(root);
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      assetLstat: (assetPath) => {
        // Model a slow antivirus / network-backed stat without making the
        // benchmark depend on one machine's filesystem latency.
        const startedAt = performance.now();
        while (performance.now() - startedAt < 0.25) {
          // Intentional synchronous delay: this is the red-capable starvation
          // seam for the old recursive refresh implementation.
        }
        return lstatSync(assetPath);
      },
    });
    services.push(service);
    const created = service.createLibrary({
      displayName: 'Reconciliation performance',
      selectedParentPath: root,
    });
    const assetsRoot = path.join(created.libraryPath, 'Assets', 'Batch');
    mkdirSync(assetsRoot, { recursive: true });
    const fileCount = 1_200;
    for (let index = 0; index < fileCount; index += 1) {
      writeFileSync(path.join(assetsRoot, `asset-${index.toString().padStart(5, '0')}.txt`), 'x');
    }

    service.closeLibrary(created.libraryId);
    const reopened = service.openLibrary(created.libraryPath);
    const measured = await collectEventLoopLagDuring(() =>
      service.runOpenBackgroundReconciliation(reopened.libraryId));
    const maxLagMs = Math.max(...measured.samples, 0);
    const p95LagMs = measured.samples
      .toSorted((left, right) => left - right)
      .at(Math.max(0, Math.ceil(measured.samples.length * 0.95) - 1)) ?? 0;
    const assetCount = service.listAssets({
      libraryId: reopened.libraryId,
      recursive: true,
    }).length;

    console.info(`RECONCILIATION_PERF_JSON ${JSON.stringify({
      fileCount,
      discoveredAssetCount: assetCount,
      elapsedMs: Number(measured.elapsedMs.toFixed(1)),
      eventLoopLagP95Ms: Number(p95LagMs.toFixed(1)),
      eventLoopLagMaxMs: Number(maxLagMs.toFixed(1)),
    })}`);

    expect(assetCount).toBe(fileCount);
    // A single timer/GC scheduling spike is not a sustained Worker stall.
    // Keep the product regression line on both distribution and worst case:
    // the p95 must remain interactive while the max leaves bounded room for
    // one host scheduling hiccup (the 20k benchmark uses the same limits).
    expect(p95LagMs).toBeLessThan(25);
    expect(maxLagMs).toBeLessThan(150);
  }, 120_000);

  it('cancels the old generation before closing its database', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-reconciliation-cancel-'));
    roots.push(root);
    const diagnostics: string[] = [];
    const service = new LibraryService({
      observerFactory: () => ({ close() {} }),
      onDiagnostic: ({ scope }) => diagnostics.push(scope),
    });
    services.push(service);
    const created = service.createLibrary({
      displayName: 'Reconciliation cancellation',
      selectedParentPath: root,
    });
    const assetsRoot = path.join(created.libraryPath, 'Assets');
    mkdirSync(assetsRoot, { recursive: true });
    for (let index = 0; index < 250; index += 1) {
      writeFileSync(path.join(assetsRoot, `asset-${index}.txt`), 'x');
    }
    service.closeLibrary(created.libraryId);
    const reopened = service.openLibrary(created.libraryPath);
    const reconciliation = service.runOpenBackgroundReconciliation(reopened.libraryId);
    await service.closeLibraryAsync(reopened.libraryId);
    await reconciliation;

    expect(diagnostics).not.toContain('open.background-reconciliation');
    expect(diagnostics).not.toContain('open.refresh-managed-assets');
    expect(() => service.openLibrary(created.libraryPath)).not.toThrow();
  }, 120_000);

  it('keeps background reconciliation parked until the interactive idle window expires', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-reconciliation-idle-'));
    roots.push(root);
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    services.push(service);
    const created = service.createLibrary({
      displayName: 'Reconciliation idle window',
      selectedParentPath: root,
    });
    service.closeLibrary(created.libraryId);
    const reopened = service.openLibrary(created.libraryPath);

    const idleWindowMs = 250;
    service.noteInteractiveActivity(reopened.libraryId, idleWindowMs);
    const startedAt = performance.now();
    await service.runOpenBackgroundReconciliation(reopened.libraryId);

    // A single 100ms wait (the old implementation) would finish far below
    // this bound. Keep enough margin for timer jitter while proving that the
    // first synchronous reconciliation stage cannot start during interaction.
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(idleWindowMs - 35);
  }, 120_000);

  it('preserves managed defaults and linked-folder rules during async discovery', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-reconciliation-rules-'));
    roots.push(root);
    const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
    services.push(service);
    const created = service.createLibrary({
      displayName: 'Reconciliation rules',
      selectedParentPath: root,
    });
    const linkedRoot = path.join(root, 'linked');
    mkdirSync(linkedRoot);
    writeFileSync(path.join(linkedRoot, 'keep.txt'), 'keep');
    service.importFolderAsLinked({
      libraryId: created.libraryId,
      sourceRootPath: linkedRoot,
    });

    service.closeLibrary(created.libraryId);
    mkdirSync(path.join(linkedRoot, 'node_modules'), { recursive: true });
    writeFileSync(path.join(linkedRoot, 'node_modules', 'ignored.txt'), 'ignored');
    writeFileSync(path.join(linkedRoot, '.DS_Store'), 'ignored');
    writeFileSync(path.join(created.libraryPath, 'Assets', '.DS_Store'), 'ignored');
    writeFileSync(path.join(created.libraryPath, 'Assets', 'visible.txt'), 'visible');

    const reopened = service.openLibrary(created.libraryPath);
    await service.runOpenBackgroundReconciliation(reopened.libraryId);
    const allAssets = service.listAssets({ libraryId: reopened.libraryId, recursive: true });

    expect(allAssets.map((asset) => `${asset.locationKind}:${asset.relativeFilePath}`).sort())
      .toEqual(['linked:keep.txt', 'managed:visible.txt']);
  }, 120_000);
});
