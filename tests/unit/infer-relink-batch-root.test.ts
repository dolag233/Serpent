import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inferRelinkBatchRoot } from '../../src/shared/infer-relink-batch-root';

describe('inferRelinkBatchRoot', () => {
  it('strips a matching relative suffix from the anchor path', () => {
    const root = path.join('D:', 'recovery', 'library');
    const anchor = path.join(root, 'FolderA', 'photo.png');
    expect(inferRelinkBatchRoot('FolderA/photo.png', anchor)).toBe(root);
  });

  it('falls back to the anchor parent when suffixes do not align', () => {
    const anchor = path.join('D:', 'recovery', 'renamed.png');
    expect(inferRelinkBatchRoot('FolderA/photo.png', anchor)).toBe(
      path.join('D:', 'recovery'),
    );
  });

  it('handles a root-level relative path', () => {
    const root = path.join('D:', 'recovery');
    const anchor = path.join(root, 'photo.png');
    expect(inferRelinkBatchRoot('photo.png', anchor)).toBe(root);
  });
});
