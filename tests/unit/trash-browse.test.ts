import { describe, expect, it } from 'vitest';

import {
  buildTrashBreadcrumbHops,
  filterTrashedAssetsAtTombstone,
  filterTrashedFoldersAtTombstone,
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
    coverArtifactIds: partial.coverArtifactIds ?? [],
    ...partial,
  };
}

function asset(
  assetId: string,
  opts: {
    trashedFromPath?: string | null;
    trashedFromTombstoneId?: string | null;
  } = {},
): AssetSummary {
  return {
    assetId,
    displayName: assetId,
    relativeFilePath: opts.trashedFromPath ?? assetId,
    trashedFromPath: opts.trashedFromPath ?? null,
    trashedFromTombstoneId: opts.trashedFromTombstoneId ?? null,
  } as AssetSummary;
}

describe('trash-browse (Serpent-6pcd / whvm)', () => {
  const folders = [
    folder({
      tombstoneId: 't-filled',
      relativePath: 'filled',
      name: 'filled',
      parentRelativePath: null,
      trashedAt: '2026-07-22T00:00:00.000Z',
    }),
    folder({
      tombstoneId: 't-nested',
      relativePath: 'filled/nested',
      name: 'nested',
      parentRelativePath: 'filled',
      trashedAt: '2026-07-22T00:00:00.000Z',
    }),
  ];

  it('lists only top-level tombstones at trash root', () => {
    expect(
      filterTrashedFoldersAtTombstone(folders, null).map((row) => row.name),
    ).toEqual(['filled']);
  });

  it('lists direct child tombstones under a tombstone', () => {
    expect(
      filterTrashedFoldersAtTombstone(folders, 't-filled').map((row) => row.name),
    ).toEqual(['nested']);
  });

  it('keeps same-name root tombstones distinct', () => {
    const sameName = [
      folder({
        tombstoneId: 't-a',
        folderId: 'folder-a',
        relativePath: 'photos',
        name: 'photos',
        trashedAt: '2026-07-22T01:00:00.000Z',
      }),
      folder({
        tombstoneId: 't-b',
        folderId: 'folder-b',
        relativePath: 'photos',
        name: 'photos',
        trashedAt: '2026-07-22T02:00:00.000Z',
      }),
    ];
    expect(
      filterTrashedFoldersAtTombstone(sameName, null).map((row) => row.tombstoneId),
    ).toEqual(['t-a', 't-b']);
    const assets = [
      asset('a1.png', { trashedFromTombstoneId: 't-a' }),
      asset('b1.png', { trashedFromTombstoneId: 't-b' }),
    ];
    expect(
      filterTrashedAssetsAtTombstone(assets, sameName, 't-a').map((row) => row.assetId),
    ).toEqual(['a1.png']);
    expect(
      filterTrashedAssetsAtTombstone(assets, sameName, 't-b').map((row) => row.assetId),
    ).toEqual(['b1.png']);
  });

  it('shows root assets only when unbound to a surviving tombstone', () => {
    const assets = [
      asset('root.png', { trashedFromPath: 'root.png' }),
      asset('nested.png', { trashedFromTombstoneId: 't-nested' }),
      asset('orphan.png', { trashedFromPath: 'gone/orphan.png' }),
    ];
    expect(
      filterTrashedAssetsAtTombstone(assets, folders, null).map((row) => row.assetId),
    ).toEqual(['root.png', 'orphan.png']);
  });

  it('shows direct assets under the current tombstone hop', () => {
    const assets = [
      asset('a.png', { trashedFromTombstoneId: 't-filled' }),
      asset('b.png', { trashedFromTombstoneId: 't-nested' }),
    ];
    expect(
      filterTrashedAssetsAtTombstone(assets, folders, 't-filled').map(
        (row) => row.assetId,
      ),
    ).toEqual(['a.png']);
  });

  it('builds breadcrumb hops from tombstone ids', () => {
    expect(buildTrashBreadcrumbHops(folders, 't-nested', '回收站')).toEqual([
      { tombstoneId: null, label: '回收站' },
      { tombstoneId: 't-filled', label: 'filled' },
      { tombstoneId: 't-nested', label: 'nested' },
    ]);
  });
});
