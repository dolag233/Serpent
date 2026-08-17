import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { inferRelinkBatchRoot } from '../../src/shared/infer-relink-batch-root';

// Build absolute expectations portably: path.join('D:', ...) is absolute on
// Windows but relative on POSIX, which used to mask the missing-root bug.
const root = path.parse(process.cwd()).root;
const abs = (...segments: string[]) => path.join(root, ...segments);

describe('inferRelinkBatchRoot', () => {
  it('strips a matching relative suffix from the anchor path', () => {
    const batchRoot = abs('recovery', 'library');
    const anchor = path.join(batchRoot, 'FolderA', 'photo.png');
    expect(inferRelinkBatchRoot('FolderA/photo.png', anchor)).toBe(batchRoot);
  });

  it('keeps a deep absolute root intact (Serpent-zc9y regression)', () => {
    const batchRoot = abs('var', 'tmp', 'serpent-trash-relink-test', 'replacements');
    const anchor = path.join(batchRoot, 'img.png');
    expect(inferRelinkBatchRoot('img.png', anchor)).toBe(batchRoot);
  });

  it('falls back to the anchor parent when suffixes do not align', () => {
    const anchor = abs('recovery', 'renamed.png');
    expect(inferRelinkBatchRoot('FolderA/photo.png', anchor)).toBe(
      abs('recovery'),
    );
  });

  it('handles a root-level relative path', () => {
    const batchRoot = abs('recovery');
    const anchor = path.join(batchRoot, 'photo.png');
    expect(inferRelinkBatchRoot('photo.png', anchor)).toBe(batchRoot);
  });

  it('returns the filesystem root when the anchor sits directly under it', () => {
    const anchor = path.join(root, 'photo.png');
    expect(inferRelinkBatchRoot('photo.png', anchor)).toBe(root);
  });
});
