import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearActiveRecentLibrary,
  readActiveLibraryPath,
  readRecentLibraryEntries,
  recentLibraryPersistenceEnabled,
  rememberRecentLibrary,
} from '../../src/main/recent-libraries';
import { buildRecentLibraryMenuEntries } from '../../src/renderer/LibrarySwitcher';

describe('recent libraries store (main)', () => {
  let storeDirectory = '';
  let storePath = '';
  let originalE2E: string | undefined;
  let originalRestoreRecent: string | undefined;

  beforeEach(() => {
    originalE2E = process.env.SERPENT_E2E;
    originalRestoreRecent = process.env.SERPENT_E2E_RESTORE_RECENT;
    delete process.env.SERPENT_E2E;
    delete process.env.SERPENT_E2E_RESTORE_RECENT;
    storeDirectory = mkdtempSync(path.join(tmpdir(), 'serpent-recent-store-'));
    storePath = path.join(storeDirectory, 'recent-library.json');
  });

  afterEach(() => {
    if (originalE2E === undefined) delete process.env.SERPENT_E2E;
    else process.env.SERPENT_E2E = originalE2E;
    if (originalRestoreRecent === undefined) {
      delete process.env.SERPENT_E2E_RESTORE_RECENT;
    } else {
      process.env.SERPENT_E2E_RESTORE_RECENT = originalRestoreRecent;
    }
    rmSync(storeDirectory, { force: true, recursive: true });
  });

  it('remembers a library as a schema v2 file with owner-only permissions', () => {
    rememberRecentLibrary(
      storePath,
      { path: '/libraries/素材合集', name: '素材合集' },
      { now: new Date('2026-07-17T08:00:00.000Z') },
    );

    expect(JSON.parse(readFileSync(storePath, 'utf8'))).toEqual({
      version: 2,
      activePath: '/libraries/素材合集',
      libraries: [
        {
          path: '/libraries/素材合集',
          name: '素材合集',
          lastOpenedAt: '2026-07-17T08:00:00.000Z',
        },
      ],
    });
    if (process.platform === 'win32') {
      // Windows file protection is ACL-based; Node's chmod only toggles the
      // read-only attribute and stat always reports 0o666 for writable files,
      // so owner-only mode cannot be asserted here (known platform limitation:
      // the 0o600 call is a no-op on Windows ACLs).
      expect(statSync(storePath).isFile()).toBe(true);
    } else {
      expect(statSync(storePath).mode & 0o777).toBe(0o600);
    }
  });

  it('migrates a v1 single-library file, deriving the name from the path basename', () => {
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        libraryPath: '/libraries/旧资源库',
        updatedAt: '2026-07-01T08:00:00.000Z',
      }),
    );

    expect(readRecentLibraryEntries(storePath)).toEqual([
      {
        path: '/libraries/旧资源库',
        name: '旧资源库',
        lastOpenedAt: '2026-07-01T08:00:00.000Z',
      },
    ]);
    // A v1 file only exists when the library was open at quit, so the active
    // path must survive migration to keep LIB-002 restart restore unchanged.
    expect(readActiveLibraryPath(storePath)).toBe('/libraries/旧资源库');
  });

  it('dedupes by path: re-opening bumps the entry to the front and re-stamps it', () => {
    rememberRecentLibrary(
      storePath,
      { path: '/libraries/alpha', name: 'Alpha' },
      { now: new Date('2026-07-10T08:00:00.000Z') },
    );
    rememberRecentLibrary(
      storePath,
      { path: '/libraries/beta', name: 'Beta' },
      { now: new Date('2026-07-11T08:00:00.000Z') },
    );
    const entries = rememberRecentLibrary(
      storePath,
      { path: '/libraries/alpha', name: 'Alpha 改名' },
      { now: new Date('2026-07-12T08:00:00.000Z') },
    );

    expect(entries).toEqual([
      {
        path: '/libraries/alpha',
        name: 'Alpha 改名',
        lastOpenedAt: '2026-07-12T08:00:00.000Z',
      },
      {
        path: '/libraries/beta',
        name: 'Beta',
        lastOpenedAt: '2026-07-11T08:00:00.000Z',
      },
    ]);
    expect(readRecentLibraryEntries(storePath)).toEqual(entries);
  });

  it('caps the list at 8 entries, keeping the most recently opened', () => {
    for (let index = 0; index < 10; index += 1) {
      rememberRecentLibrary(
        storePath,
        { path: `/libraries/lib-${index}`, name: `库 ${index}` },
        { now: new Date(`2026-07-${String(10 + index)}T08:00:00.000Z`) },
      );
    }

    const entries = readRecentLibraryEntries(storePath);
    expect(entries).toHaveLength(8);
    expect(entries[0]?.path).toBe('/libraries/lib-9');
    expect(entries[7]?.path).toBe('/libraries/lib-2');
    expect(entries.some((entry) => entry.path === '/libraries/lib-0')).toBe(false);
  });

  it('keeps LIB-002 semantics: most recent open restores, close clears restore but keeps the list', () => {
    rememberRecentLibrary(storePath, { path: '/libraries/a', name: 'A' });
    rememberRecentLibrary(storePath, { path: '/libraries/b', name: 'B' });
    expect(readActiveLibraryPath(storePath)).toBe('/libraries/b');

    clearActiveRecentLibrary(storePath);
    expect(readActiveLibraryPath(storePath)).toBeNull();
    expect(readRecentLibraryEntries(storePath).map((entry) => entry.path)).toEqual([
      '/libraries/b',
      '/libraries/a',
    ]);
  });

  it('does not persist or read anything when E2E gating disables persistence', () => {
    process.env.SERPENT_E2E = '1';
    expect(recentLibraryPersistenceEnabled()).toBe(false);

    rememberRecentLibrary(storePath, { path: '/libraries/a', name: 'A' });
    expect(existsSync(storePath)).toBe(false);
    expect(readRecentLibraryEntries(storePath)).toEqual([]);
    expect(readActiveLibraryPath(storePath)).toBeNull();

    process.env.SERPENT_E2E_RESTORE_RECENT = '1';
    expect(recentLibraryPersistenceEnabled()).toBe(true);
    rememberRecentLibrary(storePath, { path: '/libraries/a', name: 'A' });
    expect(readRecentLibraryEntries(storePath)).toHaveLength(1);
    expect(readActiveLibraryPath(storePath)).toBe('/libraries/a');
  });

  it('treats malformed or unknown-shape files as an empty store', () => {
    writeFileSync(storePath, 'not json{{{');
    expect(readRecentLibraryEntries(storePath)).toEqual([]);
    expect(readActiveLibraryPath(storePath)).toBeNull();

    writeFileSync(storePath, JSON.stringify({ version: 99, libraries: 'oops' }));
    expect(readRecentLibraryEntries(storePath)).toEqual([]);
    expect(readActiveLibraryPath(storePath)).toBeNull();

    // A v1 file with a non-absolute path is rejected, matching the old reader.
    writeFileSync(
      storePath,
      JSON.stringify({ version: 1, libraryPath: 'relative/path', updatedAt: '2026-07-01T08:00:00.000Z' }),
    );
    expect(readRecentLibraryEntries(storePath)).toEqual([]);
    expect(readActiveLibraryPath(storePath)).toBeNull();
  });

  it('recovers the store after a failed restore without corrupting the list', () => {
    // Simulates a hand-written v1 file pointing at a deleted library: the read
    // side must still migrate it so the entry shows up under 其他资源库.
    writeFileSync(
      storePath,
      JSON.stringify({
        version: 1,
        libraryPath: path.join(storeDirectory, 'deleted-library'),
        updatedAt: '2026-07-01T08:00:00.000Z',
      }),
    );

    const entries = readRecentLibraryEntries(storePath);
    expect(entries).toEqual([
      {
        path: path.join(storeDirectory, 'deleted-library'),
        name: 'deleted-library',
        lastOpenedAt: '2026-07-01T08:00:00.000Z',
      },
    ]);
  });
});

describe('buildRecentLibraryMenuEntries', () => {
  it('excludes the currently open library and preserves store order', () => {
    const entries = [
      { path: '/libraries/a', name: '资源库 A' },
      { path: '/libraries/b', name: '资源库 B' },
      { path: '/libraries/c', name: '资源库 C' },
    ];

    expect(buildRecentLibraryMenuEntries(entries, '/libraries/b')).toEqual([
      { path: '/libraries/a', name: '资源库 A' },
      { path: '/libraries/c', name: '资源库 C' },
    ]);
    expect(buildRecentLibraryMenuEntries(entries, null)).toEqual(entries);
    expect(buildRecentLibraryMenuEntries([], null)).toEqual([]);
  });
});
