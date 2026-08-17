import { describe, expect, it } from 'vitest';

import {
  createEmptyManifest,
  isNewerEntry,
  mergeManifests,
  parseManifest,
  serializeManifest,
  type SyncManifestEntry,
} from '../../src/worker/sync/manifest';

function entry(overrides: Partial<SyncManifestEntry>): SyncManifestEntry {
  return {
    path: 'assets/a.png',
    contentHash: 'hash-a',
    size: 10,
    version: 1,
    deviceId: 'dev-1',
    modifiedAt: '2026-08-15T10:00:00Z',
    metadataVersion: 1,
    ...overrides,
  };
}

describe('sync manifest (Serpent-xffq)', () => {
  it('round-trips through serialize/parse', () => {
    const manifest = createEmptyManifest({ libraryId: 'lib-1', displayName: '参考库', directoryName: '参考库' });
    manifest.entries.a1 = entry({ path: '概念/机甲.psd', contentHash: 'deadbeef' });
    const parsed = parseManifest(serializeManifest(manifest));
    expect(parsed.libraryId).toBe('lib-1');
    expect(parsed.entries.a1).toEqual(manifest.entries.a1);
  });

  it('rejects wrong format versions and malformed manifests', () => {
    expect(() => parseManifest(JSON.stringify({ formatVersion: 99, libraryId: 'x', entries: {} }))).toThrow(/Unsupported/);
    expect(() => parseManifest('{"formatVersion":1}')).toThrow(/Malformed/);
  });

  it('orders entries by version, then modifiedAt, then hash', () => {
    const base = entry({});
    expect(isNewerEntry(entry({ version: 2 }), base)).toBe(true);
    expect(isNewerEntry(entry({ version: 0 }), base)).toBe(false);
    expect(isNewerEntry(entry({ modifiedAt: '2026-08-15T11:00:00Z' }), base)).toBe(true);
    expect(isNewerEntry(entry({ modifiedAt: '2026-08-15T09:00:00Z' }), base)).toBe(false);
    expect(isNewerEntry(entry({ contentHash: 'hash-b' }), base)).toBe(true);
  });

  it('merges manifests entry-wise and detects true conflicts', () => {
    const local = createEmptyManifest({ libraryId: 'lib-1', displayName: '库', directoryName: '库' });
    const remote = createEmptyManifest({ libraryId: 'lib-1', displayName: '库', directoryName: '库' });
    // a1: 双方哈希一致 → 取新者。
    local.entries.a1 = entry({ version: 2 });
    remote.entries.a1 = entry({ version: 3 });
    // a2: 仅远端新增。
    remote.entries.a2 = entry({ path: 'b.png', contentHash: 'hash-b' });
    // a3: 仅本地新增。
    local.entries.a3 = entry({ path: 'c.png', contentHash: 'hash-c' });
    // a4: 双方都改且哈希不同 → 冲突。
    local.entries.a4 = entry({ path: 'd.png', contentHash: 'hash-l', version: 5 });
    remote.entries.a4 = entry({ path: 'd.png', contentHash: 'hash-r', version: 5 });

    const { merged, conflicts } = mergeManifests(local, remote);
    expect(merged.entries.a1!.version).toBe(3);
    expect(merged.entries.a2).toBeTruthy();
    expect(merged.entries.a3).toBeTruthy();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.assetId).toBe('a4');
  });

  it('keeps local-only entries on merge', () => {
    const local = createEmptyManifest({ libraryId: 'lib-1', displayName: '库', directoryName: '库' });
    const remote = createEmptyManifest({ libraryId: 'lib-1', displayName: '库', directoryName: '库' });
    local.entries.only = entry({});
    const { merged } = mergeManifests(local, remote);
    expect(merged.entries.only).toBeTruthy();
  });
});
