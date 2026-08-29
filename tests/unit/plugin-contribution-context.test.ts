import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPluginMenuContributionContext } from '../../src/renderer/plugin-contribution-context';

type MenuAsset = Parameters<typeof createPluginMenuContributionContext>[0]['assets'][number];

const image = (input: Partial<MenuAsset> & Pick<MenuAsset, 'assetId' | 'displayName'>): MenuAsset => ({
  assetId: input.assetId,
  displayName: input.displayName,
  locationKind: input.locationKind ?? 'managed',
  availability: input.availability ?? 'available',
  deletedAt: input.deletedAt ?? null,
  mediaType: input.mediaType ?? 'image',
});

const assetDescriptor = (asset: MenuAsset) => ({
  type: 'asset' as const,
  assetId: asset.assetId,
  displayName: asset.displayName,
  locationKind: asset.locationKind,
  isAvailable: asset.availability === 'available',
  isDeleted: asset.deletedAt !== null,
});

describe('plugin menu contribution context', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } });
    vi.stubGlobal('window', { name: 'window-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('constructs a single JPG asset selection with normalized extension and summary', () => {
    const asset = image({ assetId: 'jpg-1', displayName: 'Poster.JPG' });
    const context = createPluginMenuContributionContext({
      descriptor: assetDescriptor(asset),
      assets: [asset],
      libraryId: 'library-a',
    });

    expect(context.selection).toMatchObject({
      count: 1,
      primaryId: 'jpg-1',
      assetCount: 1,
      folderCount: 0,
      mixed: false,
      extensions: ['jpg'],
      mimeTypes: ['image/jpeg', 'image/*'],
      mediaKinds: ['image'],
      summary: {
        managedCount: 1,
        unmanagedCount: 0,
        availableCount: 1,
        unavailableCount: 0,
        deletedCount: 0,
        hasDeleted: false,
        hasUnavailable: false,
      },
      hasDeleted: false,
      hasUnavailable: false,
    });
  });

  it('reports JFIF assets as JPEG to plugin menu contributions', () => {
    const asset = image({ assetId: 'jfif-1', displayName: 'Reference.JFIF' });
    const context = createPluginMenuContributionContext({
      descriptor: assetDescriptor(asset),
      assets: [asset],
      libraryId: 'library-a',
    });

    expect(context.selection).toMatchObject({
      extensions: ['jfif'],
      mimeTypes: ['image/jpeg', 'image/*'],
    });
  });

  it('constructs a JPEG/PNG multi-selection without collapsing asset identity', () => {
    const jpeg = image({ assetId: 'jpeg-1', displayName: 'A.JPEG' });
    const png = image({ assetId: 'png-1', displayName: 'B.png' });
    const context = createPluginMenuContributionContext({
      descriptor: { type: 'multi-asset', assetIds: ['jpeg-1', 'png-1'], count: 2 },
      assets: [jpeg, png],
      libraryId: 'library-a',
    });

    expect(context.selection).toMatchObject({
      count: 2,
      primaryId: 'jpeg-1',
      assetCount: 2,
      folderCount: 0,
      mixed: false,
      extensions: ['jpeg', 'png'],
      mimeTypes: ['image/jpeg', 'image/*', 'image/png'],
      mediaKinds: ['image'],
    });
  });

  it('marks asset/folder selections as mixed and reports deleted or unavailable assets', () => {
    const deleted = image({
      assetId: 'deleted-1',
      displayName: 'Deleted.png',
      locationKind: 'linked',
      availability: 'missing',
      deletedAt: '2026-08-01T00:00:00.000Z',
    });
    const context = createPluginMenuContributionContext({
      descriptor: {
        type: 'multi-asset',
        assetIds: ['deleted-1'],
        folderIds: ['folder-1'],
        count: 2,
      },
      assets: [deleted],
      libraryId: 'library-a',
    });

    expect(context.selection).toMatchObject({
      count: 2,
      assetCount: 1,
      folderCount: 1,
      mixed: true,
      hasDeleted: true,
      hasUnavailable: true,
      summary: {
        managedCount: 0,
        unmanagedCount: 1,
        availableCount: 0,
        unavailableCount: 1,
        deletedCount: 1,
        hasDeleted: true,
        hasUnavailable: true,
      },
    });
  });

  it('constructs an empty workspace context without browser-dependent values', () => {
    const context = createPluginMenuContributionContext({
      descriptor: { type: 'workspace' },
      assets: [],
    });

    expect(context).toMatchObject({
      app: { platform: 'MacIntel', locale: 'zh-CN' },
      window: { windowId: 'window-1' },
      library: { open: false, writable: false, offline: false },
      selection: {
        count: 0,
        assetCount: 0,
        folderCount: 0,
        mixed: false,
      },
    });
  });

  it('preserves the current browse scope and viewer snapshot for menu predicates', () => {
    const asset = image({ assetId: 'viewer-1', displayName: 'Preview.PNG' });
    const context = createPluginMenuContributionContext({
      descriptor: assetDescriptor(asset),
      assets: [asset],
      libraryId: 'library-a',
      browse: {
        folderId: 'folder-1',
        collectionId: 'collection-1',
        tagId: 'tag-1',
        search: 'hero',
        filter: 'format=png&favorite=yes',
      },
      viewer: {
        active: true,
        assetId: 'viewer-1',
        extension: 'png',
        mimeType: 'image/png',
        mediaKind: 'image',
        fullscreen: true,
      },
    });

    expect(context.browse).toEqual({
      folderId: 'folder-1',
      collectionId: 'collection-1',
      tagId: 'tag-1',
      search: 'hero',
      filter: 'format=png&favorite=yes',
    });
    expect(context.viewer).toEqual({
      active: true,
      assetId: 'viewer-1',
      extension: 'png',
      mimeType: 'image/png',
      mediaKind: 'image',
      fullscreen: true,
    });
  });

  it('advances revision when the same context identity receives new state', () => {
    const asset = image({ assetId: 'revision-1', displayName: 'Revision.png' });
    const base = {
      descriptor: assetDescriptor(asset),
      assets: [asset],
      libraryId: 'library-a',
    } as const;
    const first = createPluginMenuContributionContext(base);
    const unchanged = createPluginMenuContributionContext(base);
    const changed = createPluginMenuContributionContext({
      ...base,
      busy: true,
      browse: { folderId: 'folder-2' },
    });

    expect(unchanged.revision).toBe(first.revision);
    expect(changed.revision).toBeGreaterThan(first.revision);
    expect(changed.app.busy).toBe(true);
  });
});
