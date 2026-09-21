import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LibraryService } from '../../src/worker/library-service';

const roots: string[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAACAEAAAABCAIAAAAqtLKbAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAOklEQVRYhe3YQQ0AAAgDMeRMImInBh+kySno8yZbESBAgAABAgQIECBAgAABAgQIECBAgAABAnk3zA9mXOIiDxU7WQAAAABJRU5ErkJggg==',
  'base64',
);

afterEach(() => {
  for (const root of roots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Windows can retain a fixture handle briefly after close.
    }
  }
});

describe('linked import thumbnail admission', () => {
  it('keeps the linked scene cap below an unbounded catalog enqueue', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-linked-thumb-admit-'));
    roots.push(root);
    const sourceRoot = path.join(root, 'source');
    mkdirSync(sourceRoot);
    const fileCount = 60;
    for (let index = 0; index < fileCount; index += 1) {
      writeFileSync(
        path.join(sourceRoot, `thumb-admit-${index}-x.png`),
        Buffer.concat([png, Buffer.from([index])]),
      );
    }

    const service = new LibraryService();
    const library = service.createLibrary({
      displayName: 'Linked Thumb Admit',
      selectedParentPath: root,
    });
    service.importFolderAsLinked({
      libraryId: library.libraryId,
      sourceRootPath: sourceRoot,
    });

    const bounded = service.enqueueThumbnailJobs(library.libraryId, {
      limit: 50,
      priority: 250,
      skipStaleRepair: true,
    });
    expect(bounded).toBe(50);

    const remaining = service.enqueueThumbnailJobs(library.libraryId, {
      skipStaleRepair: true,
    });
    expect(remaining).toBe(fileCount - 50);

    service.closeAll();
  });
});
