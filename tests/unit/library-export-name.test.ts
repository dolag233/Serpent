import { describe, expect, it } from 'vitest';

import { libraryExportDefaultName } from '../../src/shared/library-export-name';

describe('libraryExportDefaultName', () => {
  it('uses the current library name for folder and zip exports', () => {
    expect(libraryExportDefaultName('My Library', 'folder')).toBe('My Library');
    expect(libraryExportDefaultName('My Library', 'zip')).toBe('My Library.zip');
    expect(libraryExportDefaultName('My Library.zip', 'zip')).toBe('My Library.zip');
    expect(libraryExportDefaultName('测试资源库', 'zip')).toBe('测试资源库.zip');
  });

  it('sanitizes destination-invalid characters and trailing separators', () => {
    expect(libraryExportDefaultName('Shots: 2026/08? ', 'zip')).toBe(
      'Shots- 2026-08.zip',
    );
  });

  it('falls back for blank and Windows-reserved names', () => {
    expect(libraryExportDefaultName('   ', 'folder')).toBe(
      'serpent-library-export',
    );
    expect(libraryExportDefaultName('CON', 'zip')).toBe(
      'serpent-library-export.zip',
    );
  });
});
