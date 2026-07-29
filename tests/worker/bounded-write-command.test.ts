import { describe, expect, it, vi } from 'vitest';

import {
  boundedWriteLibraryId,
  executeBoundedWriteWorkerCommand,
} from '../../src/worker/bounded-write-command';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { LibraryService } from '../../src/worker/library-service';

const libraryId = '11111111-1111-4111-8111-111111111111';

describe('boundedWriteLibraryId', () => {
  it('puts Desktop and future Script/MCP rating changes behind the shared per-library lease', () => {
    expect(boundedWriteLibraryId({
      type: 'asset.rating.set',
      libraryId,
      assetIds: ['22222222-2222-4222-8222-222222222222'],
      rating: 4,
    } satisfies WorkerCommand)).toBe(libraryId);
  });

  it('keeps reads and long-running media work outside the bounded command lease', () => {
    expect(boundedWriteLibraryId({
      type: 'asset.search',
      libraryId,
      query: { clauses: [{ field: null, values: ['Ser'], exclude: false }] },
    } satisfies WorkerCommand)).toBeUndefined();
    expect(boundedWriteLibraryId({
      type: 'media.process-thumbnail-queue',
      libraryId,
    } satisfies WorkerCommand)).toBeUndefined();
  });

  it('maps the bounded rating command to the normal domain result without a parallel mutation path', () => {
    const setAssetsRating = vi.fn().mockReturnValue({ updatedCount: 2, skipped: ['missing-asset'] });
    const libraryService = { setAssetsRating } as unknown as LibraryService;
    const command = {
      type: 'asset.rating.set',
      libraryId,
      assetIds: ['first-asset', 'missing-asset', 'second-asset'],
      rating: 4,
    } satisfies WorkerCommand;

    expect(executeBoundedWriteWorkerCommand(libraryService, command)).toEqual({
      ok: true,
      type: 'asset.rating.updated',
      updatedCount: 2,
      skipped: ['missing-asset'],
    });
    expect(setAssetsRating).toHaveBeenCalledOnce();
    expect(setAssetsRating).toHaveBeenCalledWith(command);
  });
});
