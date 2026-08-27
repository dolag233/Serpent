import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  LibraryParentError,
  resolveWritableLibraryParent,
} from '../../src/worker/library-parent';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('resolveWritableLibraryParent (Serpent-sq4i)', () => {
  it('creates a missing parent folder when asked', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-parent-'));
    roots.push(root);
    const missing = path.join(root, 'does-not-exist-yet');
    const resolved = resolveWritableLibraryParent({
      selectedParentPath: missing,
      createIfMissing: true,
    });
    // macOS exposes the temporary directory through both /var and
    // /private/var. The implementation returns the canonical real path;
    // compare canonical identities rather than the symlink spelling.
    expect(realpathSync(resolved)).toBe(realpathSync(path.resolve(missing)));
  });

  it('accepts a trailing separator from a folder picker', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-parent-trail-'));
    roots.push(root);
    const resolved = resolveWritableLibraryParent({
      selectedParentPath: `${root}${path.sep}`,
      createIfMissing: false,
    });
    expect(realpathSync(resolved)).toBe(realpathSync(path.resolve(root)));
  });

  it('rejects a destination inside the source library', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-parent-inside-'));
    roots.push(root);
    const source = path.join(root, 'source.library');
    mkdirSync(source);
    expect(() => resolveWritableLibraryParent({
      selectedParentPath: source,
      sourceRootPath: source,
      createIfMissing: false,
    })).toThrow(LibraryParentError);
    try {
      resolveWritableLibraryParent({
        selectedParentPath: source,
        sourceRootPath: source,
        createIfMissing: false,
      });
    } catch (error) {
      expect(error).toMatchObject({ reason: 'LIBRARY_PARENT_INSIDE_SOURCE' });
    }
  });

  it('accepts a filesystem root as a parent when it is writable (Serpent-qn6k)', () => {
    const root = path.parse(process.cwd()).root;
    try {
      const resolved = resolveWritableLibraryParent({
        selectedParentPath: root,
        createIfMissing: false,
      });
      expect(path.resolve(resolved)).toBe(path.resolve(root));
    } catch (error) {
      expect(error).toBeInstanceOf(LibraryParentError);
      expect(error).toMatchObject({ reason: 'PERMISSION_DENIED' });
    }
  });

  it('rejects a file used as the parent folder', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-parent-file-'));
    roots.push(root);
    const filePath = path.join(root, 'not-a-folder');
    writeFileSync(filePath, 'nope');
    expect(() => resolveWritableLibraryParent({
      selectedParentPath: filePath,
      createIfMissing: false,
    })).toThrowError(/folder/i);
  });
});
