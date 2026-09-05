// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FolderCard } from '../../src/renderer/FolderCard';
import { LocaleProvider } from '../../src/renderer/i18n';
import type { FolderBrowseEntry } from '../../src/shared/asset-types';

function renderFolderCard(element: React.ReactElement): string {
  return renderToStaticMarkup(
    <LocaleProvider initialPreference="zh-CN">
      {element}
    </LocaleProvider>,
  );
}

function createMockEntry(overrides?: Partial<FolderBrowseEntry>): FolderBrowseEntry {
  return {
    folderId: 'folder-1',
    parentFolderId: null,
    locationKind: 'managed',
    name: '节目策划',
    relativePath: '节目策划',
    status: 'available',
    directAssetCount: 0,
    recursiveAssetCount: 3,
    childFolderCount: 3,
    coverArtifactIds: [],
    coverAssetIds: [],
    linkedFolderId: null,
    ...overrides,
  };
}

const noop = () => {};

describe('FolderCard collage rendering (Serpent-9021d1)', () => {
  it('renders standard single cover photo when directAssetCount > 0', () => {
    const entry = createMockEntry({
      directAssetCount: 5,
      coverArtifactIds: ['art-direct-1'],
    });

    const html = renderFolderCard(
      <FolderCard
        entry={entry}
        libraryId="lib-1"
        selected={false}
        onClick={noop}
        onDoubleClick={noop}
        onContextMenu={noop}
        onMouseDown={noop}
      />,
    );

    expect(html).toContain('folder-card-cover-photo');
    expect(html).toContain('art-direct-1');
    expect(html).not.toContain('folder-card-collage');
    expect(html).not.toContain('folder-card-cover-empty');
  });

  it('renders empty folder icon when directAssetCount === 0 and coverArtifactIds is empty', () => {
    const entry = createMockEntry({
      directAssetCount: 0,
      coverArtifactIds: [],
    });

    const html = renderFolderCard(
      <FolderCard
        entry={entry}
        libraryId="lib-1"
        selected={false}
        onClick={noop}
        onDoubleClick={noop}
        onContextMenu={noop}
        onMouseDown={noop}
      />,
    );

    expect(html).toContain('folder-card-cover-empty');
    expect(html).not.toContain('folder-card-collage');
    expect(html).not.toContain('folder-card-cover-photo');
  });

  it('renders 2x2 collage with 4 cells when pure folder has 4 child covers', () => {
    const entry = createMockEntry({
      directAssetCount: 0,
      recursiveAssetCount: 4,
      coverArtifactIds: ['art-sub-1', 'art-sub-2', 'art-sub-3', 'art-sub-4'],
    });

    const html = renderFolderCard(
      <FolderCard
        entry={entry}
        libraryId="lib-1"
        selected={false}
        onClick={noop}
        onDoubleClick={noop}
        onContextMenu={noop}
        onMouseDown={noop}
      />,
    );

    expect(html).toContain('folder-card-collage');
    expect(html).not.toContain('folder-card-cover-photo');
    expect(html).not.toContain('folder-card-cover-empty');

    // All 4 image artifacts are rendered inside collage cells
    expect(html).toContain('art-sub-1');
    expect(html).toContain('art-sub-2');
    expect(html).toContain('art-sub-3');
    expect(html).toContain('art-sub-4');
    expect(html).toContain('folder-card-collage-image');

    // Caption shows name and recursive count
    expect(html).toContain('节目策划');
  });

  it('renders 2x2 collage structure even when pure folder has fewer than 4 covers', () => {
    const entry = createMockEntry({
      directAssetCount: 0,
      recursiveAssetCount: 2,
      coverArtifactIds: ['art-sub-1', 'art-sub-2'],
    });

    const html = renderFolderCard(
      <FolderCard
        entry={entry}
        libraryId="lib-1"
        selected={false}
        onClick={noop}
        onDoubleClick={noop}
        onContextMenu={noop}
        onMouseDown={noop}
      />,
    );

    expect(html).toContain('folder-card-collage');
    expect(html).toContain('art-sub-1');
    expect(html).toContain('art-sub-2');
    expect(html).not.toContain('art-sub-3');

    // Contains 4 collage cells in the 2x2 grid
    const cellMatches = html.match(/folder-card-collage-cell/g);
    expect(cellMatches).toHaveLength(4);

    // Only 2 of the cells have images
    const imgMatches = html.match(/folder-card-collage-image/g);
    expect(imgMatches).toHaveLength(2);
  });
});
