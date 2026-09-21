import { expect, test, vi } from 'vitest';

import { executeBrowseSessionWorkerCommand } from '../../src/worker/handlers/browse-session';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

const session = {
  sessionId: 'session-1',
  libraryId: 'lib-1',
  libraryGeneration: 3,
  changeSequence: 8,
  queryFingerprint: 'fp-1',
  query: null,
  filters: null,
  scope: null,
  sort: null,
  showIgnored: false,
  declaredTotal: 1,
  assetIds: ['asset-1'],
  createdAt: 1,
};

function browseRequest(
  command: WorkerRequest['command'],
  performance?: WorkerRequest['performance'],
): WorkerRequest {
  return {
    requestId: 'req-1',
    command,
    ...(performance === undefined ? {} : { performance }),
  };
}

test('browse.session.open maps the service snapshot onto the opened result', () => {
  const libraryService = {
    createBrowseSession: vi.fn(() => ({
      session,
      items: [{ assetId: 'asset-1' }],
      total: 1,
      offset: 0,
      snippets: [{ assetId: 'asset-1', text: 'hit' }],
    })),
  } as unknown as LibraryService;

  expect(executeBrowseSessionWorkerCommand(
    libraryService,
    () => 3,
    browseRequest({
      type: 'browse.session.open',
      libraryId: 'lib-1',
      query: null,
      showIgnored: true,
    }),
  )).toEqual({
    ok: true,
    type: 'browse.session.opened',
    sessionId: 'session-1',
    libraryGeneration: 3,
    changeSequence: 8,
    catalogSequence: 8,
    snapshotGeneration: null,
    queryFingerprint: 'fp-1',
    items: [{ assetId: 'asset-1' }],
    total: 1,
    offset: 0,
    snippets: [{ assetId: 'asset-1', text: 'hit' }],
  });
  expect(libraryService.createBrowseSession).toHaveBeenCalledWith({
    libraryId: 'lib-1',
    libraryGeneration: 3,
    query: null,
    filters: null,
    scope: null,
    sort: null,
    smartCollectionId: null,
    limit: 100,
    showIgnored: true,
  });
});

test('browse.session.page reports missing sessions as stale', () => {
  const libraryService = {
    readBrowseSessionPage: vi.fn(() => ({ status: 'missing' as const })),
  } as unknown as LibraryService;

  expect(executeBrowseSessionWorkerCommand(
    libraryService,
    () => 0,
    browseRequest({
      type: 'browse.session.page',
      libraryId: 'lib-1',
      sessionId: 'session-1',
    }),
  )).toEqual({
    ok: true,
    type: 'browse.session.stale',
    sessionId: 'session-1',
    reason: 'missing',
  });
});

test('browse.session.ids returns catalog-sequence stale when the envelope is ahead', () => {
  const libraryService = {
    readBrowseSessionAssetIds: vi.fn(() => ({
      status: 'ready' as const,
      session,
      assetIds: ['asset-1'],
    })),
  } as unknown as LibraryService;

  expect(executeBrowseSessionWorkerCommand(
    libraryService,
    () => 3,
    browseRequest(
      {
        type: 'browse.session.ids',
        libraryId: 'lib-1',
        sessionId: 'session-1',
      },
      {
        lane: 'interactive-control',
        sentAtEpochMs: 1,
        minCatalogSequence: 9,
      },
    ),
  )).toEqual({
    ok: true,
    type: 'browse.session.stale',
    sessionId: 'session-1',
    reason: 'catalog-sequence',
  });
});

test('browse.session.close closes the owned session id', () => {
  const libraryService = {
    closeBrowseSession: vi.fn(),
  } as unknown as LibraryService;

  expect(executeBrowseSessionWorkerCommand(
    libraryService,
    () => 0,
    browseRequest({
      type: 'browse.session.close',
      libraryId: 'lib-1',
      sessionId: 'session-1',
    }),
  )).toEqual({
    ok: true,
    type: 'browse.session.closed',
    sessionId: 'session-1',
  });
  expect(libraryService.closeBrowseSession).toHaveBeenCalledWith({
    type: 'browse.session.close',
    libraryId: 'lib-1',
    sessionId: 'session-1',
  });
});

test('non-browse commands are left to the remaining dispatcher', () => {
  expect(executeBrowseSessionWorkerCommand(
    {} as LibraryService,
    () => 0,
    browseRequest({ type: 'library.list' }),
  )).toBeUndefined();
});
