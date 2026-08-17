import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  readExtensionBrowseFolderIds,
  recordExtensionBrowseFolder,
} from '../../src/main/extension-recent-browse-folders';

describe('extension-recent-browse-folders', () => {
  it('records and reads recent browsed folders per library', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'serpent-ext-browse-'));
    const filePath = path.join(dir, 'browse.json');
    try {
      recordExtensionBrowseFolder(filePath, 'lib-a', 'folder-1');
      recordExtensionBrowseFolder(filePath, 'lib-a', 'folder-2');
      recordExtensionBrowseFolder(filePath, 'lib-a', 'folder-1');
      expect(readExtensionBrowseFolderIds(filePath, 'lib-a')).toEqual([
        'folder-1',
        'folder-2',
      ]);
      expect(readExtensionBrowseFolderIds(filePath, 'lib-b')).toEqual([]);
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { version: number };
      expect(raw.version).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
