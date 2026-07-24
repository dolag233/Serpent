import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inferRelinkBatchRoot } from '../../src/shared/infer-relink-batch-root';

// Anchor paths must be absolute: in production they come from a file dialog,
// and `inferRelinkBatchRoot` resolves them against cwd. Using `D:`-style
// inputs on POSIX produces cwd-relative paths, which made this suite
// platform-dependent (it only passed on Windows).
const BASE = process.platform === 'win32' ? 'C:\\recovery' : '/recovery';

describe('inferRelinkBatchRoot', () => {
  it('strips a matching relative suffix from the anchor path', () => {
    const root = path.join(BASE, 'library');
    const anchor = path.join(root, 'FolderA', 'photo.png');
    expect(inferRelinkBatchRoot('FolderA/photo.png', anchor)).toBe(root);
  });

  it('falls back to the anchor parent when suffixes do not align', () => {
    const anchor = path.join(BASE, 'renamed.png');
    expect(inferRelinkBatchRoot('FolderA/photo.png', anchor)).toBe(BASE);
  });

  it('handles a root-level relative path', () => {
    const anchor = path.join(BASE, 'photo.png');
    expect(inferRelinkBatchRoot('photo.png', anchor)).toBe(BASE);
  });
});
