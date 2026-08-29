import { describe, expect, it } from 'vitest';

import { ArtifactDescriptorCache } from '../../src/worker/artifact-descriptor-cache';

describe('ArtifactDescriptorCache', () => {
  it('uses the change sequence as a local coherence fence', () => {
    const cache = new ArtifactDescriptorCache<{ artifactId: string }>(2);
    const key = ArtifactDescriptorCache.key('lib-1', 'asset-1', 'rev-1', 'thumbnail');
    cache.set(key, { artifactId: 'artifact-1' }, 10);

    expect(cache.get(key, 10)).toEqual({ artifactId: 'artifact-1' });
    expect(cache.get(key, 11)).toBeUndefined();
    expect(cache.metrics()).toMatchObject({ hits: 1, misses: 1, invalidations: 1 });
  });

  it('keeps generator-specific identities separate and evicts LRU entries', () => {
    const cache = new ArtifactDescriptorCache<string>(2);
    const oldKey = ArtifactDescriptorCache.key('lib', 'asset', 'rev', 'viewer_image', 'v1');
    const newKey = ArtifactDescriptorCache.key('lib', 'asset', 'rev', 'viewer_image', 'v2');
    const otherKey = ArtifactDescriptorCache.key('lib', 'other', 'rev', 'thumbnail');
    cache.set(oldKey, 'old', 1);
    cache.set(newKey, 'new', 1);
    expect(cache.get(oldKey, 1)).toBe('old');
    cache.set(otherKey, 'other', 1);

    expect(cache.get(oldKey, 1)).toBe('old');
    expect(cache.get(newKey, 1)).toBeUndefined();
    expect(cache.metrics()).toMatchObject({ evictions: 1, misses: 1 });
  });

  it('invalidates one library without flushing another', () => {
    const cache = new ArtifactDescriptorCache<string>();
    const first = ArtifactDescriptorCache.key('lib-a', 'asset', 'rev', 'thumbnail');
    const second = ArtifactDescriptorCache.key('lib-b', 'asset', 'rev', 'thumbnail');
    cache.set(first, 'a', 1);
    cache.set(second, 'b', 1);
    cache.invalidateLibrary('lib-a');

    expect(cache.get(first, 1)).toBeUndefined();
    expect(cache.get(second, 1)).toBe('b');
  });
});
