import { expect, test, vi } from 'vitest';

import { runWithVerifiedDestructiveBackup } from '../../src/worker/destructive-backup';
import type { LibraryService } from '../../src/worker/library-service';

test('failed safety backup blocks deletion and releases the writer lease', async () => {
  const release = vi.fn();
  const stop = vi.fn();
  const service = {
    acquireWriteLease: vi.fn(async () => ({
      assertCurrent: vi.fn(),
      startHeartbeat: () => ({ stop, error: undefined }),
      release,
    })),
    createDatabaseBackup: vi.fn(async () => false),
    reportDiagnostic: vi.fn(),
  } as unknown as LibraryService;
  const deleteFiles = vi.fn(async () => undefined);

  await expect(runWithVerifiedDestructiveBackup(service, 'fixture-library', deleteFiles))
    .rejects.toMatchObject({ code: 'LIBRARY_BACKUP_FAILED' });
  expect(deleteFiles).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalledOnce();
  expect(release).toHaveBeenCalledOnce();
});

test('destruction starts only after a verified backup under the same lease', async () => {
  const events: string[] = [];
  const service = {
    acquireWriteLease: vi.fn(async () => {
      events.push('lease');
      return {
        assertCurrent: () => events.push('assert'),
        startHeartbeat: () => ({ stop: () => events.push('heartbeat-stop'), error: undefined }),
        release: () => events.push('release'),
      };
    }),
    createDatabaseBackup: vi.fn(async () => {
      events.push('backup');
      return true;
    }),
    reportDiagnostic: vi.fn(),
  } as unknown as LibraryService;

  await runWithVerifiedDestructiveBackup(service, 'fixture-library', async () => {
    events.push('delete');
  });
  expect(events).toEqual(['lease', 'backup', 'assert', 'delete', 'heartbeat-stop', 'release']);
});
