import { describe, expect, it } from 'vitest';

import {
  shouldOpenTrashRestoreDialog,
  silentTrashRestoreRequest,
} from '../../src/renderer/trash-restore-flow';

describe('trash-restore-flow (Serpent-0hnx)', () => {
  it('opens the dialog only when preview reports name conflicts', () => {
    expect(shouldOpenTrashRestoreDialog(false)).toBe(false);
    expect(shouldOpenTrashRestoreDialog(true)).toBe(true);
  });

  it('silent restore targets the original folder with keep-both', () => {
    expect(silentTrashRestoreRequest(['a1', 'a2'])).toEqual({
      assetIds: ['a1', 'a2'],
      target: 'original',
      conflictStrategy: 'keep-both',
    });
  });
});
