import { expect, test, vi } from 'vitest';

import { executeTagWorkerCommand } from '../../src/worker/handlers/tags';
import type { LibraryService } from '../../src/worker/library-service';
import type { WorkerRequest } from '../../src/shared/protocol/requests';

function tagRequest(command: WorkerRequest['command']): WorkerRequest {
  return { requestId: 'req-1', command };
}

test('tag.list returns library tags', () => {
  const tags = [{ tagId: 'tag-1', name: 'hero' }];
  const libraryService = {
    listTags: vi.fn(() => tags),
  } as unknown as LibraryService;

  expect(executeTagWorkerCommand(
    libraryService,
    tagRequest({ type: 'tag.list', libraryId: 'lib-1' }),
  )).toEqual({
    ok: true,
    type: 'tag.list',
    tags,
  });
});

test('tag.merge returns the merged tag ids', () => {
  const tag = { tagId: 'tag-3', name: 'combined' };
  const libraryService = {
    mergeTags: vi.fn(() => tag),
  } as unknown as LibraryService;

  expect(executeTagWorkerCommand(
    libraryService,
    tagRequest({
      type: 'tag.merge',
      libraryId: 'lib-1',
      sourceTagIds: ['tag-1', 'tag-2'],
      name: 'combined',
    }),
  )).toEqual({
    ok: true,
    type: 'tag.merged',
    tag,
    mergedTagIds: ['tag-1', 'tag-2'],
  });
});

test('tag.assign stays on the bounded-write path', () => {
  expect(() => executeTagWorkerCommand(
    {} as LibraryService,
    tagRequest({
      type: 'tag.assign',
      libraryId: 'lib-1',
      assetIds: ['asset-1'],
      tagIds: ['tag-1'],
    }),
  )).toThrow('Bounded tag.assign write was not dispatched through its transaction fence.');
});
