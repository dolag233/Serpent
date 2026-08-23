import { describe, expect, it, vi } from 'vitest';
import { SourcePathCache, type SourcePathResolution } from '../../src/main/source-path-cache';

const source: SourcePathResolution = {
  libraryId: 'library-1',
  assetId: 'asset-1',
  revisionId: 'revision-1',
  absolutePath: 'E:/assets/file.pdf',
  mimeType: 'application/pdf',
};

describe('SourcePathCache', () => {
  it('coalesces concurrent range lookups and reuses the resolved path', async () => {
    const cache = new SourcePathCache();
    let release!: (value: SourcePathResolution) => void;
    const resolve = vi.fn(() => new Promise<SourcePathResolution>((done) => {
      release = done;
    }));

    const first = cache.getOrResolve(source, resolve);
    const second = cache.getOrResolve(source, resolve);
    expect(resolve).toHaveBeenCalledTimes(1);
    release(source);
    await expect(first).resolves.toEqual(source);
    await expect(second).resolves.toEqual(source);
    await expect(cache.getOrResolve(source, resolve)).resolves.toEqual(source);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('invalidates one revision and all revisions for a library', async () => {
    const cache = new SourcePathCache();
    const other = { ...source, revisionId: 'revision-2' };
    const resolve = vi.fn(async (value: SourcePathResolution) => value);
    await cache.getOrResolve(source, () => resolve(source));
    await cache.getOrResolve(other, () => resolve(other));
    expect(cache.has(source.libraryId, source.assetId, source.revisionId)).toBe(true);
    cache.delete(source.libraryId, source.assetId, source.revisionId);
    expect(cache.has(source.libraryId, source.assetId, source.revisionId)).toBe(false);
    expect(cache.has(other.libraryId, other.assetId, other.revisionId)).toBe(true);
    cache.clearLibrary(source.libraryId);
    expect(cache.has(other.libraryId, other.assetId, other.revisionId)).toBe(false);
  });
});
