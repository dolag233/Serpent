import { describe, expect, it } from 'vitest';

import type { AssetSummary } from '../../src/shared/asset-types';
import {
  groupTrashedAssetsBySourceFolder,
  trashGroupKey,
} from '../../src/renderer/trash-folder-groups';

function asset(
  id: string,
  trashedFromPath: string | null,
): AssetSummary {
  return {
    assetId: id,
    displayName: id,
    trashedFromPath,
  } as AssetSummary;
}

describe('trash-folder-groups', () => {
  it('groups by parent folder path', () => {
    const groups = groupTrashedAssetsBySourceFolder(
      [
        asset('a', '/library/Assets/Hero/a.png'),
        asset('b', '/library/Assets/Hero/b.png'),
        asset('c', '/library/Assets/Props/c.png'),
        asset('root', '/library/Assets/root.png'),
      ],
      'Library root',
    );
    expect(groups.map((group) => group.key)).toEqual([
      '/library/Assets',
      '/library/Assets/Hero',
      '/library/Assets/Props',
    ]);
    expect(groups[1]?.label).toBe('Hero');
    expect(groups[0]?.assets).toHaveLength(1);
    expect(groups[1]?.assets).toHaveLength(2);
  });

  it('uses dirname for trashGroupKey', () => {
    expect(trashGroupKey('/library/Assets/Hero/a.png')).toBe('/library/Assets/Hero');
    expect(trashGroupKey('/library/Assets/root.png')).toBe('/library/Assets');
    expect(trashGroupKey('root.png')).toBe('');
  });
});
