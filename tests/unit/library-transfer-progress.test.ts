import { describe, expect, it } from 'vitest';

import {
  isLibraryOpenTransferKind,
  libraryTransferHeadlineKey,
  libraryTransferKindFromOperation,
} from '../../src/renderer/library-transfer-progress';

describe('library transfer progress copy (Serpent-lvif)', () => {
  it('maps Eagle opening to Eagle copy, not Billfish or import', () => {
    expect(libraryTransferKindFromOperation('open-eagle')).toBe('open-eagle');
    expect(libraryTransferHeadlineKey('open-eagle')).toEqual({
      key: 'progress.validatingEagleLibrary',
    });
    expect(isLibraryOpenTransferKind('open-eagle')).toBe(true);
  });

  it('keeps Billfish on its own validating copy', () => {
    expect(libraryTransferKindFromOperation('open-billfish')).toBe('open-billfish');
    expect(libraryTransferHeadlineKey('open-billfish')).toEqual({
      key: 'progress.validatingBillfishLibrary',
    });
  });

  it('does not treat Eagle opening as an import headline', () => {
    expect(libraryTransferHeadlineKey('import')).toEqual({
      key: 'progress.importingLibrary',
    });
  });
});
