import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LibraryInputError,
  copyNameForIndex,
  normalizeAbsolutePath,
  normalizeAssetFileBaseName,
  normalizeLibraryName,
  normalizeRelativeAssetPath,
  isPortablePathEqualOrDescendant,
  portablePathIdentity,
  stripWindowsExtendedPathPrefix,
  stripTrailingPathSeparators,
  targetLibraryPath,
} from '../../src/worker/library-rules';

describe('library name rules', () => {
  it('accepts a trimmed Unicode display name of at most 80 code points', () => {
    expect(normalizeLibraryName('  灵感素材 📷  ')).toBe('灵感素材 📷');
    expect(normalizeLibraryName('画'.repeat(80))).toBe('画'.repeat(80));
  });

  it.each([
    '',
    '   ',
    '.',
    '..',
    'nested/library',
    'nested\\library',
    'question?.png',
    'quote"name',
    'colon:name',
    'line\nbreak',
    'NUL',
    'con.txt',
    'COM9',
    'LPT1.backup',
    'trailing.',
    '画'.repeat(81),
  ])('rejects the cross-platform unsafe name %j', (displayName) => {
    expect(() => normalizeLibraryName(displayName)).toThrow(LibraryInputError);
  });
});

describe('library path rules', () => {
  it('accepts an absolute path and derives a child target', () => {
    const parentPath = path.resolve('/tmp', 'Serpent tests');
    expect(normalizeAbsolutePath(parentPath)).toBe(path.normalize(parentPath));
    expect(targetLibraryPath(parentPath, 'Concept Art')).toBe(
      path.join(parentPath, 'Concept Art'),
    );
  });

  it('strips trailing separators so Windows folder-picker paths still join (Serpent-sq4i)', () => {
    const parentPath = path.resolve('/tmp', 'Serpent tests');
    const withTrailing = `${parentPath}${path.sep}`;
    expect(stripTrailingPathSeparators(withTrailing)).toBe(parentPath);
    expect(normalizeAbsolutePath(withTrailing)).toBe(path.normalize(parentPath));
    expect(targetLibraryPath(withTrailing, 'Concept Art')).toBe(
      path.join(parentPath, 'Concept Art'),
    );
  });

  it('allows a filesystem root as the library parent (Serpent-qn6k)', () => {
    const root = path.parse(process.cwd()).root;
    expect(targetLibraryPath(root, 'Concept Art')).toBe(path.join(root, 'Concept Art'));
  });

  it.each(['relative/path', ' /tmp/library', '/tmp/library ', '/tmp/bad\0path'])(
    'rejects an unsafe selected path %j',
    (selectedPath) => {
      expect(() => normalizeAbsolutePath(selectedPath)).toThrow(LibraryInputError);
    },
  );

  it('rejects a library whose full target path exceeds 240 UTF-8 bytes (Windows long-path guard)', () => {
    // 80 CJK code points pass the name gate but are 240 bytes alone; with the
    // parent prefix the full path crosses the guard — on every platform.
    const longName = '资'.repeat(80);
    expect(() => targetLibraryPath(path.resolve('/tmp', 'p'), longName))
      .toThrow(LibraryInputError);
  });

  it.each([
    ['\\\\?\\C:\\Library\\Concept Art', 'C:\\Library\\Concept Art'],
    ['\\\\?\\UNC\\server\\share\\Library\\Concept Art', '\\\\server\\share\\Library\\Concept Art'],
    ['\\\\?\\unc\\server\\share\\Library\\Concept Art', '\\\\server\\share\\Library\\Concept Art'],
    ['\\\\server\\share\\Library\\Concept Art', '\\\\server\\share\\Library\\Concept Art'],
    ['C:\\Library\\Concept Art', 'C:\\Library\\Concept Art'],
    ['/plain/posix/path', '/plain/posix/path'],
  ])('normalizes Windows extended path spelling %j without changing its root', (input, expected) => {
    expect(stripWindowsExtendedPathPrefix(input)).toBe(expected);
  });
});

describe('managed asset path rules', () => {
  it('normalizes portable relative paths to database separators', () => {
    expect(normalizeRelativeAssetPath('UI\\Buttons\\primary.png')).toBe(
      'UI/Buttons/primary.png',
    );
  });

  it.each(['', '.', '..', '../escape.png', 'safe/../../escape.png', '/absolute.png']) (
    'rejects an unsafe relative asset path %j',
    (relativePath) => {
      expect(() => normalizeRelativeAssetPath(relativePath)).toThrow(LibraryInputError);
    },
  );

  it.each([
    'a<b.png',
    'a>b.png',
    'a:b.png',
    'a?b.png',
    'a*b.png',
    'a|b.png',
    'a"b.png',
  ])('rejects NTFS-illegal characters in relative asset paths %j', (relativePath) => {
    expect(() => normalizeRelativeAssetPath(relativePath)).toThrow(LibraryInputError);
  });

  it('adds a deterministic copy suffix before the final extension', () => {
    expect(copyNameForIndex('button.png', 2)).toBe('button (2).png');
    expect(copyNameForIndex('archive.tar.gz', 3)).toBe('archive.tar (3).gz');
    expect(copyNameForIndex('.gitignore', 2)).toBe('.gitignore (2)');
  });

  it('builds a locale-independent NFC and case-insensitive identity per segment', () => {
    expect(portablePathIdentity('UI/Café/FOO.PNG')).toBe('ui/café/foo.png');
    expect(portablePathIdentity('ui/Cafe\u0301/foo.png')).toBe(
      portablePathIdentity('UI/Café/FOO.PNG'),
    );
    expect(portablePathIdentity('Straße/ς.txt')).toBe(
      portablePathIdentity('STRASSE/Σ.TXT'),
    );
  });

  it('matches folder descendants using portable path identity', () => {
    expect(isPortablePathEqualOrDescendant('UI/Cafe\u0301/Buttons', 'ui/café')).toBe(true);
    expect(isPortablePathEqualOrDescendant('ui/café', 'UI/Café')).toBe(true);
    expect(isPortablePathEqualOrDescendant('ui/cafeteria', 'ui/café')).toBe(false);
  });
});

describe('asset file base-name gate (Windows portability)', () => {
  it.each([
    'con',
    'con.txt',
    'COM9',
    'LPT1.backup',
    'nul',
    'a<b',
    'a>b',
    'a:b',
    'a?b',
    'a*b',
    'a|b',
    'a"b',
    'tab\tname',
    'newline\nname',
  ])('rejects the Windows-unsafe base name %j', (baseName) => {
    expect(() => normalizeAssetFileBaseName(baseName)).toThrow(LibraryInputError);
  });

  it('rejects a base name over 255 UTF-8 bytes', () => {
    // 86 × 3 bytes = 258 bytes > 255 — rejected.
    expect(() => normalizeAssetFileBaseName('资'.repeat(86))).toThrow(LibraryInputError);
  });

  it('accepts a portable Unicode base name at the byte limit', () => {
    // 85 × 3 bytes = 255 bytes — the gate is strict (`> 255`), so it passes;
    // the extension is caller-owned.
    expect(normalizeAssetFileBaseName('资'.repeat(85))).toBe('资'.repeat(85));
    expect(normalizeAssetFileBaseName('资'.repeat(84))).toBe('资'.repeat(84));
  });

  it('rejects separator, relative and trailing-dot spellings', () => {
    expect(() => normalizeAssetFileBaseName('a/b')).toThrow(LibraryInputError);
    expect(() => normalizeAssetFileBaseName('a\\b')).toThrow(LibraryInputError);
    expect(() => normalizeAssetFileBaseName('..')).toThrow(LibraryInputError);
    expect(() => normalizeAssetFileBaseName('trailing.')).toThrow(LibraryInputError);
  });
});
