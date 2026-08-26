import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readPendingCleanupAsidePaths,
  writePendingCleanupAsidePaths,
} from '../../src/main/pending-cleanup-store';

describe('pending cleanup store (Serpent-65d837)', () => {
  let storeDirectory = '';
  let storePath = '';

  beforeEach(() => {
    storeDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-pending-cleanup-'));
    storePath = path.join(storeDirectory, 'pending-library-cleanup.json');
  });

  afterEach(() => {
    rmSync(storeDirectory, { recursive: true, force: true });
  });

  it('reports an empty set when the file does not exist', () => {
    expect(readPendingCleanupAsidePaths(storePath)).toEqual([]);
  });

  it('round-trips aside paths and deduplicates them', () => {
    expect(
      writePendingCleanupAsidePaths(storePath, [
        '/media/库.del-100',
        '/media/库.del-101',
        '/media/库.del-100',
      ]),
    ).toBe(true);
    expect(readPendingCleanupAsidePaths(storePath)).toEqual([
      '/media/库.del-100',
      '/media/库.del-101',
    ]);
  });

  it('overwrites the full set on rewrite', () => {
    writePendingCleanupAsidePaths(storePath, ['/media/库.del-100']);
    writePendingCleanupAsidePaths(storePath, ['/media/库.del-200']);
    expect(readPendingCleanupAsidePaths(storePath)).toEqual(['/media/库.del-200']);
  });

  it('drops entries that do not carry the .del- marker', () => {
    writePendingCleanupAsidePaths(storePath, ['/media/真实目录', '/media/库.del-100']);
    expect(readPendingCleanupAsidePaths(storePath)).toEqual(['/media/库.del-100']);
  });

  it('returns an empty set for corrupt json', () => {
    writeFileSync(storePath, '{not-json', 'utf8');
    expect(readPendingCleanupAsidePaths(storePath)).toEqual([]);
  });

  it('creates the store file on first write', () => {
    expect(existsSync(storePath)).toBe(false);
    writePendingCleanupAsidePaths(storePath, ['/media/库.del-100']);
    expect(existsSync(storePath)).toBe(true);
  });
});
