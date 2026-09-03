import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import { importNoConflict } from './import-no-conflict';

const roots: string[] = [];
const services: LibraryService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('BrowseSession', () => {
  it('reuses ordered pages and marks the snapshot stale after a library change', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-browse-session-'));
    roots.push(root);
    const service = new LibraryService();
    services.push(service);
    const library = service.createLibrary({ displayName: 'BrowseSession', selectedParentPath: root });
    const firstSource = path.join(root, 'b.png');
    const secondSource = path.join(root, 'a.png');
    writeFileSync(firstSource, 'first');
    writeFileSync(secondSource, 'second');
    importNoConflict(service, library.libraryId, firstSource);
    importNoConflict(service, library.libraryId, secondSource);

    const session = service.createBrowseSession({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      query: null,
      sort: { field: 'name', order: 'asc' },
      limit: 1,
    });
    expect(session.total).toBe(2);
    expect(session.items).toHaveLength(1);
    expect(session.items[0]!.displayName).toBe('a.png');

    const page = service.readBrowseSessionPage({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      sessionId: session.session.sessionId,
      limit: 1,
      offset: 1,
    });
    expect(page).toMatchObject({ status: 'ready', total: 2, offset: 1 });
    if (page.status === 'ready') expect(page.items[0]!.displayName).toBe('b.png');

    const geometry = service.readBrowseSessionGeometry({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      sessionId: session.session.sessionId,
      startIndex: 1,
      limit: 1,
    });
    expect(geometry).toMatchObject({ status: 'ready', startIndex: 1 });
    if (geometry.status === 'ready') {
      expect(geometry.entries).toHaveLength(1);
      expect(geometry.entries[0]).toMatchObject({ index: 1, assetId: expect.any(String) });
    }

    const searchedSession = service.createBrowseSession({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      query: {
        clauses: [{ field: 'filename', values: ['png'], exclude: false }],
      },
      sort: { field: 'name', order: 'asc' },
      limit: 1,
    });
    expect(searchedSession.total).toBe(2);
    const searchedPage = service.readBrowseSessionPage({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      sessionId: searchedSession.session.sessionId,
      limit: 1,
      offset: 1,
    });
    expect(searchedPage).toMatchObject({ status: 'ready', offset: 1 });
    if (searchedPage.status === 'ready') {
      expect(searchedPage.snippets?.some((snippet) => snippet.assetId === searchedPage.items[0]?.assetId)).toBe(true);
    }

    const navigation = service.getLibraryNavigationSummary({
      libraryId: library.libraryId,
      includeTrashedFolders: true,
    });
    expect(navigation).toMatchObject({
      libraryId: library.libraryId,
      allAssetCount: 2,
      rootAssetCount: 2,
      trashedAssetCount: 0,
    });
    expect(service.getLibraryNavigationSummary({
      libraryId: library.libraryId,
      includeTrashedFolders: true,
    })).toBe(navigation);
    await expect(service.getLibraryNavigationSummaryAsync({
      libraryId: library.libraryId,
      includeTrashedFolders: true,
    })).resolves.toBe(navigation);

    // Background job progress is deliberately part of the broad mutation
    // fence, but it cannot reorder or change membership in this session. A
    // scroll in progress must therefore keep reading the same snapshot while
    // visible-thumbnail work is admitted.
    const browseSequenceBeforeBackgroundWork = service.getBrowseChangeSequence(library.libraryId);
    const broadSequenceBeforeBackgroundWork = service.getChangeSequence(library.libraryId);
    const queued = service.enqueueThumbnailJobs(library.libraryId, {
      assetIds: [assetIdForTest(service, library.libraryId)],
      limit: 1,
      priority: 500,
      skipStaleRepair: true,
    });
    expect(queued).toBe(1);
    expect(service.getChangeSequence(library.libraryId)).toBeGreaterThan(broadSequenceBeforeBackgroundWork);
    expect(service.getBrowseChangeSequence(library.libraryId)).toBe(browseSequenceBeforeBackgroundWork);
    expect(service.readBrowseSessionPage({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      sessionId: session.session.sessionId,
      limit: 1,
      offset: 1,
    })).toMatchObject({ status: 'ready', offset: 1 });

    // Artifact commits are also volatile derived-data writes. They invalidate
    // the descriptor cache and advance the broad fence, but must not force a
    // stable browse result to be rebuilt.
    const assetForArtifact = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    const browseSequenceBeforeArtifact = service.getBrowseChangeSequence(library.libraryId);
    const broadSequenceBeforeArtifact = service.getChangeSequence(library.libraryId);
    service.writeDerivedArtifact({
      libraryId: library.libraryId,
      assetId: assetForArtifact.assetId,
      kind: 'extracted_palette',
      mimeType: 'application/octet-stream',
      bytes: Uint8Array.from([1, 2, 3]),
      generatorVersion: 'browse-session-test@1',
    });
    expect(service.getChangeSequence(library.libraryId)).toBeGreaterThan(broadSequenceBeforeArtifact);
    expect(service.getBrowseChangeSequence(library.libraryId)).toBe(browseSequenceBeforeArtifact);
    expect(service.readBrowseSessionPage({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      sessionId: session.session.sessionId,
      limit: 1,
      offset: 1,
    })).toMatchObject({ status: 'ready', offset: 1 });

    // 0032-E.3: navigation fields and recursive counts are governed by the
    // narrow browse fence. A volatile artifact write still advances the broad
    // sequence exposed to automation, but it must reuse the already coherent
    // sidebar read model instead of rebuilding every COUNT/list query.
    const navigationAfterArtifact = service.getLibraryNavigationSummary({
      libraryId: library.libraryId,
      includeTrashedFolders: true,
    });
    expect(navigationAfterArtifact.changeSequence).toBeGreaterThan(navigation.changeSequence);
    expect(navigationAfterArtifact.folders).toBe(navigation.folders);
    expect(navigationAfterArtifact.collections).toBe(navigation.collections);
    expect(service.getLibraryNavigationSummary({
      libraryId: library.libraryId,
      includeTrashedFolders: true,
    })).toEqual(navigationAfterArtifact);

    const smart = service.createSmartCollection({
      libraryId: library.libraryId,
      name: 'PNG assets',
      queryDefinitionJson: JSON.stringify({
        search: { clauses: [{ field: 'filename', values: ['png'], exclude: false }] },
      }),
    });
    const smartSession = service.createBrowseSession({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      query: null,
      smartCollectionId: smart.collectionId,
      limit: 1,
    });
    expect(smartSession.total).toBe(2);

    const asset = service.listAssets({ libraryId: library.libraryId, recursive: true })[0]!;
    service.setAssetMetadata({
      libraryId: library.libraryId,
      assetId: asset.assetId,
      expectedVersion: 0,
      description: 'changes the durable sequence',
    });
    expect(service.readBrowseSessionPage({
      libraryId: library.libraryId,
      libraryGeneration: 7,
      sessionId: session.session.sessionId,
      limit: 1,
      offset: 1,
    })).toEqual({ status: 'stale', reason: 'change-sequence' });
  });
});

function assetIdForTest(service: LibraryService, libraryId: string): string {
  const asset = service.listAssets({ libraryId, recursive: true })[0];
  if (!asset) throw new Error('BrowseSession test requires an imported asset.');
  return asset.assetId;
}
