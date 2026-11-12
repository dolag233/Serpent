import { expect, it } from 'vitest';
import type { AssetSummary } from '../../src/shared/asset-types';
import { clipboardSelectionIds } from '../../src/renderer/clipboard-selection';

it('includes selected assets outside loaded pages and skips known unavailable assets', () => {
  const loaded = [
    { assetId: 'visible', availability: 'available', deletedAt: null },
    { assetId: 'missing', availability: 'missing', deletedAt: null },
    { assetId: 'trashed', availability: 'available', deletedAt: 'now' },
  ] as AssetSummary[];
  expect(clipboardSelectionIds(['visible', 'unloaded', 'missing', 'trashed', 'visible'], loaded)).toEqual(['visible', 'unloaded']);
});
