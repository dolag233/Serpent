import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LibraryInputError,
  normalizeAbsolutePath,
  normalizeLibraryName,
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
