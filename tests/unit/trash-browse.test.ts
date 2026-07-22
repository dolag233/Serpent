import { describe, expect, it } from 'vitest';

import {
  buildTrashBreadcrumbHops,
  filterTrashedAssetsAtPath,
  filterTrashedFoldersAtPath,
} from '../../src/renderer/trash-browse';
import type { AssetSummary, TrashedFolderSummary } from '../../src/shared/asset-types';

function folder(
  partial: Partial<TrashedFolderSummary> &
    Pick<TrashedFolderSummary, 'tombstoneId' | 'relativePath' | 'name'>,
): TrashedFolderSummary {
  return {
    folderId: partial.folderId ?? partial.tombstoneId,
    parentRelativePath: partial.parentRelativePath ?? null,
    trashedAt: partial.trashedAt ?? '2026-07-22T00:00:00.000Z',
    assetCount: partial.assetCount ?? 0,
    ...partial,
  };
}

function asset(
  assetId: string,
  trashedFromPath: string | null,
): AssetSummary {
  return {
    assetId,
    displayName: assetId,
    relativeFilePath: trashedFromPath ?? assetId,
    trashedFromPath,
  } as AssetSummary;
}

describe('trash-browse (Serpent-6pcd)', () => {
  const folders = [
    folder({
      tombstoneId: 't-filled',
      relativePath: 'filled',
      name: 'filled',
      parentRelativePath: null,
    }),
    folder({
      tombstoneId: 't-nested',
      relativePath: 'filled/nested',
      name: 'nested',
      parentRelativePath: 'filled',
    }),
  ];

  it('lists only top-level tombstones at trash root', () => {
    expect(
      filterTrashedFoldersAtPath(folders, null).map((row) => row.name),
    ).toEqual(['filled']);
  });

  it('lists direct child tombstones under a path', () => {
    expect(
      filterTrashedFoldersAtPath(folders, 'filled').map((row) => row.name),
    ).toEqual(['nested']);
  });

  it('shows root assets only when their parent is not a tombstone', () => {
    const assets = [
      asset('root.png', 'root.png'),
      asset('nested.png', 'filled/nested/nested.png'),
      asset('orphan.png', 'gone/orphan.png'),
    ];
    expect(
      filterTrashedAssetsAtPath(assets, folders, null).map((row) => row.assetId),
    ).toEqual(['root.png', 'orphan.png']);
  });

  it('shows direct assets under the current trash hop', () => {
    const assets = [
      asset('a.png', 'filled/a.png'),
      asset('b.png', 'filled/nested/b.png'),
    ];
    expect(
      filterTrashedAssetsAtPath(assets, folders, 'filled').map(
        (row) => row.assetId,
      ),
    ).toEqual(['a.png']);
  });

  it('builds breadcrumb hops from tombstone names', () => {
    expect(
      buildTrashBreadcrumbHops(folders, 'filled/nested', '回收站'),
    ).toEqual([
      { path: null, label: '回收站' },
      { path: 'filled', label: 'filled' },
      { path: 'filled/nested', label: 'nested' },
    ]);
  });
});
