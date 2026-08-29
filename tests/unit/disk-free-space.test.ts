import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_LIBRARY_STAGING_PREFIX,
  isManagedExternalLibraryStagingPath,
  listExternalLibraryStagingParents,
  requiredStagingBytes,
} from '../../src/main/disk-free-space';

describe('external library staging disk policy', () => {
  it('adds a minimum headroom on top of the uncompressed estimate', () => {
    expect(requiredStagingBytes(1_000)).toBe(1_000 + 64 * 1024 * 1024);
    expect(requiredStagingBytes(2_000 * 1024 * 1024)).toBe(2_000 * 1024 * 1024 + 200 * 1024 * 1024);
  });

  it('only treats Serpent extract directories as managed staging roots', () => {
    expect(isManagedExternalLibraryStagingPath(`${EXTERNAL_LIBRARY_STAGING_PREFIX}abc123`)).toBe(true);
    expect(isManagedExternalLibraryStagingPath('not-a-staging-dir')).toBe(false);
  });

  it('uses the preferred parent when it has enough free space', async () => {
    const choice = await listExternalLibraryStagingParents({
      preferredParent: path.join(os.tmpdir(), 'preferred'),
      fallbackParent: path.join(os.tmpdir(), 'fallback'),
      requiredBytes: 100,
      probeFreeBytes: async () => 1_000,
      pathsShareVolume: async () => false,
    });
    expect(choice.parents).toEqual([
      path.resolve(os.tmpdir(), 'preferred'),
      path.resolve(os.tmpdir(), 'fallback'),
    ]);
    expect(choice.skippedPreferredForSpace).toBe(false);
  });

  it('falls back to a different volume when the preferred parent is too small', async () => {
    const preferred = path.join(os.tmpdir(), 'preferred-full');
    const fallback = path.join(os.tmpdir(), 'fallback-ok');
    const choice = await listExternalLibraryStagingParents({
      preferredParent: preferred,
      fallbackParent: fallback,
      requiredBytes: 500,
      probeFreeBytes: async (directoryPath) => (
        directoryPath === path.resolve(preferred) ? 10 : 1_000
      ),
      pathsShareVolume: async () => false,
    });
    expect(choice.parents).toEqual([path.resolve(fallback)]);
    expect(choice.skippedPreferredForSpace).toBe(true);
  });

  it('does not fall back when the other directory is on the same volume', async () => {
    const choice = await listExternalLibraryStagingParents({
      preferredParent: path.join(os.tmpdir(), 'preferred-same'),
      fallbackParent: path.join(os.tmpdir(), 'fallback-same'),
      requiredBytes: 500,
      probeFreeBytes: async (directoryPath) => (
        directoryPath.includes('preferred-same') ? 10 : 1_000
      ),
      pathsShareVolume: async () => true,
    });
    expect(choice.parents).toEqual([]);
    expect(choice.skippedPreferredForSpace).toBe(true);
  });

  it('refuses when neither parent has enough space', async () => {
    const choice = await listExternalLibraryStagingParents({
      preferredParent: path.join(os.tmpdir(), 'preferred-empty'),
      fallbackParent: path.join(os.tmpdir(), 'fallback-empty'),
      requiredBytes: 500,
      probeFreeBytes: async () => 1,
      pathsShareVolume: async () => false,
    });
    expect(choice.parents).toEqual([]);
    expect(choice.skippedPreferredForSpace).toBe(true);
  });
});

describe('existing ancestor lookup', () => {
  it('can still choose a parent that does not exist yet when space is unknown', async () => {
    const missing = path.join(os.tmpdir(), `serpent-missing-staging-${Date.now()}`, 'child');
    const choice = await listExternalLibraryStagingParents({
      preferredParent: missing,
      requiredBytes: 100,
      probeFreeBytes: async () => undefined,
    });
    expect(choice.parents).toEqual([path.resolve(missing)]);
  });
});
