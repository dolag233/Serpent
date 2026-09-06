import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';
import type { ImportProgressEvent } from '../../src/shared/protocol/responses';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('managed asset import progress', () => {
  it('emits counted copy progress that can be cancelled between files', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-import-progress-'));
    roots.push(root);
    const sources = [0, 1, 2, 3, 4].map((index) => {
      const source = path.join(root, `file-${index}.txt`);
      writeFileSync(source, `payload-${index}`);
      return source;
    });
    const events: ImportProgressEvent[] = [];
    const service = new LibraryService({
      onProgress: (event) => {
        if (event.type === 'import.progress') events.push(event);
      },
    });
    const library = service.createLibrary({
      displayName: 'Import Progress',
      selectedParentPath: root,
    });

    await service.prepareOrExecuteImportCancellable({
      libraryId: library.libraryId,
      sourceKind: 'files',
      sourcePaths: sources,
    });

    const copyEvents = events.filter((event) => event.phase === 'copy' && event.totalFiles === 5);
    expect(copyEvents.length).toBeGreaterThan(0);
    expect(copyEvents.some((event) => event.filesProcessed > 0)).toBe(true);
    expect(copyEvents.every((event) => event.cancelable === true && event.importId.length > 0)).toBe(true);

    const cancelEvents: ImportProgressEvent[] = [];
    const cancelling = new LibraryService({
      onProgress: (event) => {
        if (event.type !== 'import.progress') return;
        cancelEvents.push(event);
        if (event.phase === 'copy' && event.importId) {
          setImmediate(() => cancelling.cancelImport(event.importId));
        }
      },
    });
    const cancelLibrary = cancelling.createLibrary({
      displayName: 'Import Cancel',
      selectedParentPath: root,
    });
    await expect(
      cancelling.prepareOrExecuteImportCancellable({
        libraryId: cancelLibrary.libraryId,
        sourceKind: 'files',
        sourcePaths: sources,
      }),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(cancelEvents.some((event) => event.phase === 'cancelled')).toBe(true);

    service.closeAll();
    cancelling.closeAll();
  });
});
