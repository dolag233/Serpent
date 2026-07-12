import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LibraryInputError,
  copyNameForIndex,
  normalizeAbsolutePath,
  normalizeLibraryName,
  normalizeRelativeAssetPath,
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

  it.each(['relative/path', ' /tmp/library', '/tmp/library ', '/tmp/bad\0path'])(
    'rejects an unsafe selected path %j',
    (selectedPath) => {
      expect(() => normalizeAbsolutePath(selectedPath)).toThrow(LibraryInputError);
    },
  );
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

  it('adds a deterministic copy suffix before the final extension', () => {
    expect(copyNameForIndex('button.png', 2)).toBe('button (2).png');
    expect(copyNameForIndex('archive.tar.gz', 3)).toBe('archive.tar (3).gz');
    expect(copyNameForIndex('.gitignore', 2)).toBe('.gitignore (2)');
  });
});
