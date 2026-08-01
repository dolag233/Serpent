import { describe, expect, it } from 'vitest';

import { applyDesktopAutomationSelection } from '../../src/renderer/use-desktop-automation-selection';

describe('applyDesktopAutomationSelection', () => {
  it('replaces the selection and makes the last requested asset primary', () => {
    expect(
      applyDesktopAutomationSelection(
        { selectedAssetIds: ['old'], primaryAssetId: 'old' },
        { assetIds: ['a', 'b', 'a'], mode: 'replace' },
      ),
    ).toEqual({
      selectedAssetIds: ['a', 'b'],
      primaryAssetId: 'b',
    });
  });

  it('adds assets without duplicating existing selection', () => {
    expect(
      applyDesktopAutomationSelection(
        { selectedAssetIds: ['a', 'b'], primaryAssetId: 'a' },
        { assetIds: ['b', 'c'], mode: 'add' },
      ),
    ).toEqual({
      selectedAssetIds: ['a', 'b', 'c'],
      primaryAssetId: 'c',
    });
  });

  it('removes assets and keeps the current primary when it remains selected', () => {
    expect(
      applyDesktopAutomationSelection(
        { selectedAssetIds: ['a', 'b', 'c'], primaryAssetId: 'b' },
        { assetIds: ['c'], mode: 'remove' },
      ),
    ).toEqual({
      selectedAssetIds: ['a', 'b'],
      primaryAssetId: 'b',
    });
  });

  it('clears the primary when removal removes the complete selection', () => {
    expect(
      applyDesktopAutomationSelection(
        { selectedAssetIds: ['a'], primaryAssetId: 'a' },
        { assetIds: ['a'], mode: 'remove' },
      ),
    ).toEqual({
      selectedAssetIds: [],
      primaryAssetId: undefined,
    });
  });
});
