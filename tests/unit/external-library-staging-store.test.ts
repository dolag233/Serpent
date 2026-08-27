import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readExternalLibraryStagingRoots,
  writeExternalLibraryStagingRoots,
} from '../../src/main/external-library-staging-store';

describe('external library staging store', () => {
  let storeDirectory = '';
  let storePath = '';

  beforeEach(() => {
    storeDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-staging-store-'));
    storePath = path.join(storeDirectory, 'external-library-staging.json');
  });

  afterEach(() => {
    rmSync(storeDirectory, { recursive: true, force: true });
  });

  it('reports an empty set when the file does not exist', () => {
    expect(readExternalLibraryStagingRoots(storePath)).toEqual([]);
    expect(existsSync(storePath)).toBe(false);
  });

  it('round-trips managed staging roots and ignores other paths', () => {
    const kept = path.join(storeDirectory, 'serpent-external-library-keep');
    expect(
      writeExternalLibraryStagingRoots(storePath, [
        kept,
        path.join(storeDirectory, 'user-folder'),
        'relative-name',
        kept,
      ]),
    ).toBe(true);
    expect(readExternalLibraryStagingRoots(storePath)).toEqual([kept]);
  });
});
