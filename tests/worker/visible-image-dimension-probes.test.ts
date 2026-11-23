import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ImageDimensionsModule from '../../src/worker/image-dimensions';

type ImageDimensions = { width: number; height: number };
type AsyncDimensionReader = (filePath: string) => Promise<ImageDimensions | null>;

const dimensionReader = vi.hoisted(() => ({
  mock: vi.fn<(filePath: string) => Promise<ImageDimensions | null>>(),
  original: undefined as AsyncDimensionReader | undefined,
}));

vi.mock('../../src/worker/image-dimensions', async (importOriginal) => {
  const actual = await importOriginal<typeof ImageDimensionsModule>();
  dimensionReader.original = actual.readImageDimensions;
  dimensionReader.mock.mockImplementation(actual.readImageDimensions);
  return {
    ...actual,
    readImageDimensions: dimensionReader.mock,
  };
});

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const roots: string[] = [];
const services: LibraryService[] = [];
const require = createRequire(import.meta.url);
const TestDatabase = require('better-sqlite3') as new (filename: string) => {
  close(): void;
  prepare(sql: string): {
    get(...parameters: unknown[]): unknown;
    run(...parameters: unknown[]): { changes: number };
  };
};

const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);
const FIXTURE_IMAGE_NAMES = ['alpha', 'bravo', 'charlie', 'delta', 'echo'] as const;

type Fixture = {
  assetIds: string[];
  assets: Array<{ assetId: string; relativeFilePath: string; currentRevisionId: string }>;
  libraryId: string;
  libraryPath: string;
  service: LibraryService;
};

type LinkedFixture = Fixture & { linkedFolderId: string };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function temporaryRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-visible-dimension-probe-'));
  roots.push(root);
  return root;
}

function clearExtractedDimensions(libraryPath: string, revisionIds: readonly string[]): void {
  const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  try {
    const remove = database.prepare(
      "DELETE FROM revision_artifacts WHERE revision_id = ? AND kind = 'extracted_metadata'",
    );
    for (const revisionId of revisionIds) remove.run(revisionId);
  } finally {
    database.close();
  }
}

function extractedDimensionCount(libraryPath: string, revisionId: string): number {
  const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  try {
    const row = database.prepare(
      `SELECT COUNT(*) AS count
         FROM revision_artifacts
        WHERE revision_id = ?
          AND kind = 'extracted_metadata'
          AND invalidated_at IS NULL`,
    ).get(revisionId) as { count: number };
    return row.count;
  } finally {
    database.close();
  }
}

function createFixture(input: {
  images?: number;
  includeText?: boolean;
} = {}): Fixture {
  const root = temporaryRoot();
  const sourceDirectory = path.join(root, 'source');
  mkdirSync(sourceDirectory, { recursive: true });
  const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
  services.push(service);
  const library = service.createLibrary({
    displayName: 'Visible Dimension Probe Fixture',
    selectedParentPath: root,
  });
  const images = input.images ?? 1;
  const sourcePaths: string[] = [];
  for (let index = 0; index < images; index += 1) {
    const name = FIXTURE_IMAGE_NAMES[index] ?? `fixture-${index + 1}`;
    const sourcePath = path.join(sourceDirectory, `image-${name}.png`);
    writeFileSync(sourcePath, Buffer.concat([VALID_PNG, Buffer.from([index])]));
    sourcePaths.push(sourcePath);
  }
  if (input.includeText) {
    const textPath = path.join(sourceDirectory, 'notes.txt');
    writeFileSync(textPath, 'fixture text');
    sourcePaths.push(textPath);
  }
  for (const sourcePath of sourcePaths) importNoConflict(service, library.libraryId, sourcePath);

  const assets = service.listAssets({ libraryId: library.libraryId, recursive: true })
    .map((asset) => ({
      assetId: asset.assetId,
      relativeFilePath: asset.relativeFilePath,
      currentRevisionId: asset.currentRevisionId,
    }));
  expect(assets).toHaveLength(images + (input.includeText ? 1 : 0));
  clearExtractedDimensions(library.libraryPath, assets.map((asset) => asset.currentRevisionId));
  dimensionReader.mock.mockClear();
  return {
    assetIds: assets.map((asset) => asset.assetId),
    assets,
    libraryId: library.libraryId,
    libraryPath: library.libraryPath,
    service,
  };
}

function createLinkedFixture(): LinkedFixture {
  const root = temporaryRoot();
  const sourceDirectory = path.join(root, 'linked-source');
  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(path.join(sourceDirectory, 'image-alpha.png'), Buffer.concat([VALID_PNG, Buffer.from([1])]));
  const service = new LibraryService({ observerFactory: () => ({ close() {} }) });
  services.push(service);
  const library = service.createLibrary({
    displayName: 'Visible Dimension Linked Fixture',
    selectedParentPath: root,
  });
  const linked = service.importFolderAsLinked({
    libraryId: library.libraryId,
    sourceRootPath: sourceDirectory,
  });
  const assets = service.listAssets({
    libraryId: library.libraryId,
    folderId: linked.folderId,
    recursive: true,
  }).map((asset) => ({
    assetId: asset.assetId,
    relativeFilePath: asset.relativeFilePath,
    currentRevisionId: asset.currentRevisionId,
  }));
  expect(assets).toHaveLength(1);
  clearExtractedDimensions(library.libraryPath, assets.map((asset) => asset.currentRevisionId));
  dimensionReader.mock.mockClear();
  return {
    assetIds: assets.map((asset) => asset.assetId),
    assets,
    libraryId: library.libraryId,
    libraryPath: library.libraryPath,
    linkedFolderId: linked.folderId,
    service,
  };
}

function markLinkedFolderOffline(libraryPath: string, linkedFolderId: string, assetId: string): void {
  const database = new TestDatabase(path.join(libraryPath, '.serpent', 'library.db'));
  try {
    const result = database.prepare(
      "UPDATE linked_folders SET status = 'offline' WHERE folder_id = ?",
    ).run(linkedFolderId);
    expect(result.changes).toBe(1);
    const asset = database.prepare('SELECT availability FROM assets WHERE asset_id = ?').get(assetId) as
      { availability: string } | undefined;
    expect(asset?.availability).toBe('available');
  } finally {
    database.close();
  }
}

async function waitForReadCount(count: number): Promise<void> {
  await vi.waitFor(() => expect(dimensionReader.mock).toHaveBeenCalledTimes(count), {
    timeout: 3_000,
    interval: 2,
  });
}

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  dimensionReader.mock.mockReset();
  if (dimensionReader.original) dimensionReader.mock.mockImplementation(dimensionReader.original);
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
  }
});

describe('visible-window image dimension probes', () => {
  it('publishes fast images and replenishes a consumer while one header read stays pending', async () => {
    const fixture = createFixture({ images: 4 });
    const orderedAssets = [...fixture.assets].sort((left, right) =>
      left.relativeFilePath.localeCompare(right.relativeFilePath));
    const slow = orderedAssets.find((asset) => asset.relativeFilePath === 'image-alpha.png')!;
    const remainingAssets = orderedAssets.filter((asset) => asset.assetId !== slow.assetId);
    const fastAssets = remainingAssets;
    const slowGate = deferred<ImageDimensions | null>();
    const ready: string[] = [];
    dimensionReader.mock.mockImplementation((filePath) => path.basename(filePath) === 'image-alpha.png'
      ? slowGate.promise
      : Promise.resolve({ width: 64, height: 48 }));

    let settled = false;
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      orderedAssets.map((asset) => asset.assetId),
      undefined,
      (item) => ready.push(item.assetId),
    );
    void operation.then(() => { settled = true; }, () => { settled = true; });

    try {
      await waitForReadCount(2);
      await vi.waitFor(() => expect(ready).toEqual(expect.arrayContaining(
        fastAssets.map((asset) => asset.assetId),
      )), { timeout: 3_000, interval: 2 });
      expect(dimensionReader.mock).toHaveBeenCalledTimes(4);
      expect(ready).not.toContain(slow.assetId);
      expect(settled).toBe(false);
    } finally {
      slowGate.resolve({ width: 32, height: 24 });
      await operation.catch(() => []);
    }

    expect(ready).toEqual(expect.arrayContaining(orderedAssets.map((asset) => asset.assetId)));
  });

  it('keeps one visible drain at two concurrent reads and replenishes a slot as soon as one read finishes', async () => {
    const fixture = createFixture({ images: 5 });
    const gates = fixture.assets.map(() => deferred<ImageDimensions | null>());
    const entered: string[] = [];
    let active = 0;
    let maximumActive = 0;
    dimensionReader.mock.mockImplementation((filePath) => {
      const index = entered.length;
      entered.push(path.basename(filePath));
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return gates[index]!.promise.finally(() => { active -= 1; });
    });

    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      fixture.assetIds,
    );
    try {
      await waitForReadCount(2);
      await Promise.resolve();
      expect(entered).toHaveLength(2);
      expect(maximumActive).toBe(2);
      gates[0]!.resolve({ width: 40, height: 30 });
      await waitForReadCount(3);
      expect(maximumActive).toBe(2);
      gates[1]!.resolve({ width: 40, height: 30 });
      await waitForReadCount(4);
      expect(maximumActive).toBe(2);
      gates[2]!.resolve({ width: 40, height: 30 });
      await waitForReadCount(5);
      expect(maximumActive).toBe(2);
      gates[3]!.resolve({ width: 40, height: 30 });
      await waitForReadCount(5);
      gates[4]!.resolve({ width: 40, height: 30 });
      await expect(operation).resolves.toHaveLength(5);
      expect(maximumActive).toBe(2);
    } finally {
      for (const gate of gates) gate.resolve({ width: 40, height: 30 });
      await operation.catch(() => []);
    }
  });

  it('allows three shared header reads across disjoint visible drains in one library', async () => {
    const fixture = createFixture({ images: 4 });
    const orderedAssets = [...fixture.assets].sort((left, right) =>
      left.relativeFilePath.localeCompare(right.relativeFilePath));
    const firstDrainAssets = orderedAssets.slice(0, 2);
    const secondDrainAssets = orderedAssets.slice(2, 4);
    expect(firstDrainAssets).toHaveLength(2);
    expect(secondDrainAssets).toHaveLength(2);
    const gates = Array.from({ length: 4 }, () => deferred<ImageDimensions | null>());
    const startedPaths: string[] = [];
    let active = 0;
    let maximumActive = 0;
    dimensionReader.mock.mockImplementation((filePath) => {
      const gate = gates[startedPaths.length]!;
      startedPaths.push(path.basename(filePath));
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return gate.promise.finally(() => { active -= 1; });
    });

    const firstOperation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      firstDrainAssets.map((asset) => asset.assetId),
    );
    const secondOperation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      secondDrainAssets.map((asset) => asset.assetId),
    );
    try {
      await waitForReadCount(3);
      expect(startedPaths).toHaveLength(3);
      expect(maximumActive).toBe(3);

      gates[0]!.resolve({ width: 40, height: 30 });
      await waitForReadCount(4);
      expect(startedPaths).toHaveLength(4);
      expect(maximumActive).toBe(3);

      for (let index = 1; index < gates.length; index += 1) {
        gates[index]!.resolve({ width: 40, height: 30 });
      }
      await expect(firstOperation).resolves.toHaveLength(2);
      await expect(secondOperation).resolves.toHaveLength(2);
      expect(maximumActive).toBe(3);
    } finally {
      for (const gate of gates) gate.resolve({ width: 40, height: 30 });
      await Promise.all([firstOperation.catch(() => []), secondOperation.catch(() => [])]);
    }
  });

  it('reuses another consumer’s ready dimensions for a candidate that was waiting behind header gates', async () => {
    const fixture = createFixture({ images: 3 });
    const orderedAssets = [...fixture.assets].sort((left, right) =>
      left.relativeFilePath.localeCompare(right.relativeFilePath));
    const [first, second, readyByOtherConsumer] = orderedAssets;
    expect(first?.relativeFilePath).toBe('image-alpha.png');
    expect(second?.relativeFilePath).toBe('image-bravo.png');
    expect(readyByOtherConsumer?.relativeFilePath).toBe('image-charlie.png');
    const gates = [deferred<ImageDimensions | null>(), deferred<ImageDimensions | null>()];
    const startedPaths: string[] = [];
    const ready: string[] = [];
    dimensionReader.mock.mockImplementation((filePath) => {
      const fileName = path.basename(filePath);
      startedPaths.push(fileName);
      if (fileName === first!.relativeFilePath) return gates[0]!.promise;
      if (fileName === second!.relativeFilePath) return gates[1]!.promise;
      return Promise.resolve({ width: 32, height: 24 });
    });
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      orderedAssets.map((asset) => asset.assetId),
      undefined,
      (item) => ready.push(item.assetId),
    );

    try {
      await waitForReadCount(2);
      expect([...startedPaths].sort()).toEqual(['image-alpha.png', 'image-bravo.png']);

      const otherConsumerResults = fixture.service.persistVisibleWindowImageDimensions(
        fixture.libraryId,
        [readyByOtherConsumer!.assetId],
      );
      expect(otherConsumerResults.map((item) => item.assetId)).toEqual([readyByOtherConsumer!.assetId]);
      expect(extractedDimensionCount(fixture.libraryPath, readyByOtherConsumer!.currentRevisionId)).toBe(1);
      expect(dimensionReader.mock).toHaveBeenCalledTimes(2);

      gates[0]!.resolve({ width: 40, height: 30 });
      await vi.waitFor(() => expect(ready).toContain(readyByOtherConsumer!.assetId), {
        timeout: 3_000,
        interval: 2,
      });
      expect(startedPaths).toHaveLength(2);
      expect(dimensionReader.mock).toHaveBeenCalledTimes(2);

      gates[1]!.resolve({ width: 40, height: 30 });
      await expect(operation).resolves.toHaveLength(3);
      expect(ready).toEqual(expect.arrayContaining(orderedAssets.map((asset) => asset.assetId)));
      expect(dimensionReader.mock).toHaveBeenCalledTimes(2);
    } finally {
      for (const gate of gates) gate.resolve({ width: 40, height: 30 });
      await operation.catch(() => []);
    }
  });

  it('allows four reads across two libraries with each visible drain capped at two', async () => {
    const first = createFixture({ images: 4 });
    const second = createFixture({ images: 4 });
    const gates = Array.from({ length: 8 }, () => deferred<ImageDimensions | null>());
    let active = 0;
    let maximumActive = 0;
    let started = 0;
    dimensionReader.mock.mockImplementation(() => {
      const gate = gates[started++]!;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      return gate.promise.finally(() => { active -= 1; });
    });

    const firstOperation = first.service.persistVisibleWindowImageDimensionsAsync(
      first.libraryId,
      first.assetIds,
    );
    const secondOperation = second.service.persistVisibleWindowImageDimensionsAsync(
      second.libraryId,
      second.assetIds,
    );
    try {
      await waitForReadCount(4);
      expect(started).toBe(4);
      expect(maximumActive).toBe(4);
      for (let index = 0; index < 4; index += 1) gates[index]!.resolve({ width: 40, height: 30 });
      await waitForReadCount(8);
      expect(maximumActive).toBe(4);
      for (let index = 4; index < 8; index += 1) gates[index]!.resolve({ width: 40, height: 30 });
      await expect(firstOperation).resolves.toHaveLength(4);
      await expect(secondOperation).resolves.toHaveLength(4);
      expect(maximumActive).toBe(4);
    } finally {
      for (const gate of gates) gate.resolve({ width: 40, height: 30 });
      await Promise.all([firstOperation.catch(() => []), secondOperation.catch(() => [])]);
    }
  });

  it('shares one revision header read between a visible probe and source-direct thumbnail admission', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const visible = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
    );
    let primary: Promise<number> | undefined;
    try {
      await waitForReadCount(1);

      fixture.service.enqueueThumbnailJobs(fixture.libraryId, { assetIds: [asset.assetId] });
      primary = fixture.service.processThumbnailQueue(fixture.libraryId, {
        jobKinds: ['generate_thumbnail'],
        maxJobs: 1,
        assetIds: [asset.assetId],
      });
      await Promise.resolve();
      expect(dimensionReader.mock).toHaveBeenCalledTimes(1);
      gate.resolve({ width: 32, height: 24 });

      await expect(visible).resolves.toHaveLength(1);
      await expect(primary).resolves.toBeGreaterThan(0);
      expect(dimensionReader.mock).toHaveBeenCalledTimes(1);
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await Promise.all([
        visible.catch(() => []),
        primary?.catch(() => 0) ?? Promise.resolve(0),
      ]);
    }
  });

  it('rechecks ignore state before a primary probe persists dimensions or admits source-direct', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const onResult = vi.fn();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    fixture.service.enqueueThumbnailJobs(fixture.libraryId, { assetIds: [asset.assetId] });
    const operation = fixture.service.processThumbnailQueue(fixture.libraryId, {
      jobKinds: ['generate_thumbnail'],
      maxJobs: 1,
      assetIds: [asset.assetId],
      onResult,
    });

    try {
      await waitForReadCount(1);
      fixture.service.setIgnore({
        libraryId: fixture.libraryId,
        locationKind: 'managed',
        relativePath: asset.relativeFilePath,
        pathKind: 'asset',
        ignored: true,
      });
      gate.resolve({ width: 32, height: 24 });

      await expect(operation).resolves.toBeGreaterThan(0);
      expect(onResult).not.toHaveBeenCalled();
      expect(extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId)).toBe(0);
      const database = new TestDatabase(path.join(fixture.libraryPath, '.serpent', 'library.db'));
      try {
        const job = database.prepare(
          "SELECT status, error_code FROM jobs WHERE asset_id = ? AND kind = 'generate_thumbnail'",
        ).get(asset.assetId) as { status: string; error_code: string | null };
        expect(job).toMatchObject({ status: 'cancelled', error_code: 'ASSET_IGNORED' });
      } finally {
        database.close();
      }
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => 0);
    }
  });

  it('does not persist or publish a standalone probe when its linked root goes offline during the read', async () => {
    const fixture = createLinkedFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const onReady = vi.fn();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
      undefined,
      onReady,
    );

    try {
      await waitForReadCount(1);
      markLinkedFolderOffline(fixture.libraryPath, fixture.linkedFolderId, asset.assetId);
      gate.resolve({ width: 32, height: 24 });

      await expect(operation).resolves.toEqual([]);
      expect(onReady).not.toHaveBeenCalled();
      expect(extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId)).toBe(0);
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => []);
    }
  });

  it('cancels a primary probe when its linked root goes offline during the read', async () => {
    const fixture = createLinkedFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const onResult = vi.fn();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    fixture.service.enqueueThumbnailJobs(fixture.libraryId, { assetIds: [asset.assetId] });
    const operation = fixture.service.processThumbnailQueue(fixture.libraryId, {
      jobKinds: ['generate_thumbnail'],
      maxJobs: 1,
      assetIds: [asset.assetId],
      onResult,
    });

    try {
      await waitForReadCount(1);
      markLinkedFolderOffline(fixture.libraryPath, fixture.linkedFolderId, asset.assetId);
      gate.resolve({ width: 32, height: 24 });

      await expect(operation).resolves.toBeGreaterThan(0);
      expect(onResult).not.toHaveBeenCalled();
      expect(extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId)).toBe(0);
      const database = new TestDatabase(path.join(fixture.libraryPath, '.serpent', 'library.db'));
      try {
        const job = database.prepare(
          "SELECT status, error_code FROM jobs WHERE asset_id = ? AND kind = 'generate_thumbnail'",
        ).get(asset.assetId) as { status: string; error_code: string | null };
        expect(job).toMatchObject({ status: 'cancelled', error_code: 'SOURCE_NOT_FOUND' });
      } finally {
        database.close();
      }
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => 0);
    }
  });

  it('does not persist or publish a probe that is aborted while its header read is pending', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const controller = new AbortController();
    const onReady = vi.fn();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
      controller.signal,
      onReady,
    );
    try {
      await waitForReadCount(1);
      controller.abort();
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => []);

      expect(onReady).not.toHaveBeenCalled();
      expect(extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId)).toBe(0);
    } finally {
      controller.abort();
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => []);
    }
  });

  it('does not persist or publish a header result after its candidate is no longer wanted', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const onReady = vi.fn();
    let wanted = true;
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
      undefined,
      onReady,
      () => wanted,
    );

    try {
      await waitForReadCount(1);
      wanted = false;
      gate.resolve({ width: 32, height: 24 });

      const results = await operation;
      expect({
        results,
        readyCount: onReady.mock.calls.length,
        persistedCount: extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId),
      }).toEqual({ results: [], readyCount: 0, persistedCount: 0 });
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => []);
    }
  });

  it('does not claim or read candidates excluded by the current wanted predicate', async () => {
    const fixture = createFixture({ images: 2 });
    const onReady = vi.fn();
    dimensionReader.mock.mockResolvedValue({ width: 32, height: 24 });

    const results = await fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      fixture.assetIds,
      undefined,
      onReady,
      () => false,
    );

    expect(dimensionReader.mock).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    expect(results).toEqual([]);
    expect(fixture.assets.map((asset) => extractedDimensionCount(
      fixture.libraryPath,
      asset.currentRevisionId,
    ))).toEqual([0, 0]);
  });

  it('keeps shared header reads alive for another consumer while the viewport drops old claims', async () => {
    const fixture = createFixture({ images: 4 });
    const orderedAssets = [...fixture.assets].sort((left, right) =>
      left.relativeFilePath.localeCompare(right.relativeFilePath));
    const [alpha, bravo, charlie, delta] = orderedAssets;
    expect(orderedAssets.map((asset) => asset.relativeFilePath)).toEqual([
      'image-alpha.png', 'image-bravo.png', 'image-charlie.png', 'image-delta.png',
    ]);
    const gates = new Map([
      ['image-alpha.png', deferred<ImageDimensions | null>()],
      ['image-bravo.png', deferred<ImageDimensions | null>()],
      ['image-delta.png', deferred<ImageDimensions | null>()],
    ]);
    const startedPaths: string[] = [];
    dimensionReader.mock.mockImplementation((filePath) => {
      const name = path.basename(filePath);
      startedPaths.push(name);
      const gate = gates.get(name);
      if (!gate) throw new Error(`Unexpected image header read: ${name}`);
      return gate.promise;
    });

    const wanted = new Set([alpha!.assetId, bravo!.assetId, charlie!.assetId]);
    const oldReady: string[] = [];
    const oldWindow = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [alpha!.assetId, bravo!.assetId, charlie!.assetId],
      undefined,
      (item) => oldReady.push(item.assetId),
      (assetId) => wanted.has(assetId),
    );
    const otherConsumerReady: string[] = [];
    let retainedConsumerSettled = false;
    const retainedConsumer = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [alpha!.assetId, bravo!.assetId],
      undefined,
      (item) => otherConsumerReady.push(item.assetId),
      () => true,
    ).finally(() => { retainedConsumerSettled = true; });
    let newWindowSettled = false;
    let newWindow: Promise<Array<{ assetId: string }>> | undefined;

    try {
      await waitForReadCount(2);
      expect([...startedPaths].sort()).toEqual(['image-alpha.png', 'image-bravo.png']);
      expect(retainedConsumerSettled).toBe(false);

      // The newest viewport wants delta; a second consumer still needs alpha
      // and bravo. Charlie was old-window-only and has not been claimed yet.
      wanted.clear();
      wanted.add(bravo!.assetId);
      wanted.add(delta!.assetId);
      newWindow = fixture.service.persistVisibleWindowImageDimensionsAsync(
        fixture.libraryId,
        [delta!.assetId],
        undefined,
        undefined,
        (assetId) => wanted.has(assetId),
      ).finally(() => { newWindowSettled = true; });
      await waitForReadCount(3);
      expect([...startedPaths].sort()).toEqual(['image-alpha.png', 'image-bravo.png', 'image-delta.png']);
      expect(newWindowSettled).toBe(false);

      gates.get('image-alpha.png')!.resolve({ width: 40, height: 30 });
      gates.get('image-bravo.png')!.resolve({ width: 40, height: 30 });
      gates.get('image-delta.png')!.resolve({ width: 40, height: 30 });

      const [oldResults, retainedResults, newResults] = await Promise.all([
        oldWindow,
        retainedConsumer,
        newWindow!,
      ]);

      expect(oldResults.map((item) => item.assetId)).toEqual([bravo!.assetId]);
      expect(oldReady).toEqual([bravo!.assetId]);
      expect(retainedResults.map((item) => item.assetId)).toEqual([alpha!.assetId, bravo!.assetId]);
      expect([...otherConsumerReady].sort()).toEqual([alpha!.assetId, bravo!.assetId].sort());
      expect(newResults.map((item) => item.assetId)).toEqual([delta!.assetId]);
      expect([...startedPaths].sort()).toEqual(['image-alpha.png', 'image-bravo.png', 'image-delta.png']);
      expect(extractedDimensionCount(fixture.libraryPath, alpha!.currentRevisionId)).toBe(1);
      expect(extractedDimensionCount(fixture.libraryPath, bravo!.currentRevisionId)).toBe(1);
      expect(extractedDimensionCount(fixture.libraryPath, charlie!.currentRevisionId)).toBe(0);
      expect(extractedDimensionCount(fixture.libraryPath, delta!.currentRevisionId)).toBe(1);
    } finally {
      for (const gate of gates.values()) gate.resolve({ width: 40, height: 30 });
      await Promise.all([
        oldWindow.catch(() => []),
        retainedConsumer.catch(() => []),
        newWindow?.catch(() => []) ?? Promise.resolve([]),
      ]);
    }
  });

  it('publishes an in-flight candidate when its wanted state is restored before the read finishes', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const onReady = vi.fn();
    let wanted = true;
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
      undefined,
      onReady,
      () => wanted,
    );

    try {
      await waitForReadCount(1);
      wanted = false;
      wanted = true;
      gate.resolve({ width: 32, height: 24 });

      await expect(operation).resolves.toHaveLength(1);
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId)).toBe(1);
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation.catch(() => []);
    }
  });

  it('does not persist or publish a pending probe after its library is closed and reopened', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const gate = deferred<ImageDimensions | null>();
    const onReady = vi.fn();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
      undefined,
      onReady,
    ).catch(() => []);
    try {
      await waitForReadCount(1);

      fixture.service.closeAll();
      fixture.service.openLibrary(fixture.libraryPath);
      gate.resolve({ width: 32, height: 24 });
      await operation;

      expect(onReady).not.toHaveBeenCalled();
      expect(extractedDimensionCount(fixture.libraryPath, asset.currentRevisionId)).toBe(0);
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation;
    }
  });

  it('does not write or publish dimensions after the asset changes revision mid-probe', async () => {
    const fixture = createFixture();
    const asset = fixture.assets[0]!;
    const oldRevisionId = asset.currentRevisionId;
    const gate = deferred<ImageDimensions | null>();
    const onReady = vi.fn();
    dimensionReader.mock.mockImplementation(() => gate.promise);
    const operation = fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [asset.assetId],
      undefined,
      onReady,
    ).catch(() => []);
    try {
      await waitForReadCount(1);

      const managedPath = fixture.service.resolveAssetPath(fixture.libraryId, asset.assetId);
      writeFileSync(managedPath, Buffer.concat([VALID_PNG, Buffer.from('replacement')]));
      fixture.service.refreshManagedAssets(fixture.libraryId, { assetIds: [asset.assetId] });
      const currentRevisionId = fixture.service.listAssets({ libraryId: fixture.libraryId, recursive: true })
        .find((candidate) => candidate.assetId === asset.assetId)!.currentRevisionId;
      expect(currentRevisionId).not.toBe(oldRevisionId);

      gate.resolve({ width: 32, height: 24 });
      await operation;
      expect(onReady).not.toHaveBeenCalled();
      expect(extractedDimensionCount(fixture.libraryPath, oldRevisionId)).toBe(0);
    } finally {
      gate.resolve({ width: 32, height: 24 });
      await operation;
    }
  });

  it('never reads a non-image asset header', async () => {
    const fixture = createFixture({ includeText: true });
    const image = fixture.assets.find((asset) => asset.relativeFilePath.endsWith('.png'))!;
    const text = fixture.assets.find((asset) => asset.relativeFilePath.endsWith('.txt'))!;
    dimensionReader.mock.mockResolvedValue({ width: 32, height: 24 });

    const results = await fixture.service.persistVisibleWindowImageDimensionsAsync(
      fixture.libraryId,
      [text.assetId, image.assetId],
    );

    expect(dimensionReader.mock).toHaveBeenCalledTimes(1);
    expect(path.extname(dimensionReader.mock.mock.calls[0]![0]).toLowerCase()).toBe('.png');
    expect(results.map((item) => item.assetId)).toEqual([image.assetId]);
  });
});
