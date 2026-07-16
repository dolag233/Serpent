import { describe, expect, it } from 'vitest';

import {
  assetSummarySchema,
  managedFolderSummarySchema,
  portableRelativePathSchema,
} from '../../src/shared/asset-types';

const invalidPaths = [
  '/tmp/x',
  'C:\\x',
  '\\\\server\\share',
  'folder\\file.png',
  '.',
  '..',
  './file.png',
  'folder/./file.png',
  'folder/../file.png',
  'folder//file.png',
  'folder/',
];

const validAssetSummary = {
  assetId: 'asset-01',
  locationKind: 'managed' as const,
  managedFolderId: null,
  relativeFilePath: 'folder/file.png',
  displayName: 'file.png',
  currentRevisionId: 'revision-01',
  byteSize: 42,
  modifiedAt: '2026-07-14T00:00:00.000Z',
  availability: 'available' as const,
  rating: 0,
  favorite: false,
  deletedAt: null,
  trashedFromPath: null,
  remainingDays: null,
  thumbnailStatus: null,
  thumbnailArtifactId: null,
  mediaType: 'image' as const,
  width: 1,
  height: 1,
  durationMs: null,
};

describe('portableRelativePathSchema', () => {
  it.each([
    'folder/file.png',
    '__trash__/id/file.png',
  ])('accepts canonical portable relative path %s', (relativePath) => {
    expect(portableRelativePathSchema.safeParse(relativePath).success).toBe(true);
  });

  it.each(invalidPaths)('rejects non-portable or escaping path %s', (relativePath) => {
    expect(portableRelativePathSchema.safeParse(relativePath).success).toBe(false);
  });
});

describe('renderer-facing asset paths', () => {
  it('accepts canonical asset and trash-relative paths', () => {
    expect(assetSummarySchema.safeParse(validAssetSummary).success).toBe(true);
    expect(assetSummarySchema.safeParse({
      ...validAssetSummary,
      relativeFilePath: '__trash__/asset-01/file.png',
      trashedFromPath: 'folder/file.png',
    }).success).toBe(true);
  });

  it.each(invalidPaths)('rejects unsafe AssetSummary.relativeFilePath %s', (relativeFilePath) => {
    expect(assetSummarySchema.safeParse({
      ...validAssetSummary,
      relativeFilePath,
    }).success).toBe(false);
  });

  it.each(invalidPaths)('rejects unsafe AssetSummary.trashedFromPath %s', (trashedFromPath) => {
    expect(assetSummarySchema.safeParse({
      ...validAssetSummary,
      trashedFromPath,
    }).success).toBe(false);
  });
});

describe('managed folder paths', () => {
  it('uses parentFolderId null for root-level folders and a portable relativePath', () => {
    expect(managedFolderSummarySchema.safeParse({
      folderId: 'folder-01',
      parentFolderId: null,
      name: 'UI',
      relativePath: 'UI',
    }).success).toBe(true);
    expect(managedFolderSummarySchema.safeParse({
      folderId: 'folder-02',
      parentFolderId: 'folder-01',
      name: 'Buttons',
      relativePath: 'UI/Buttons',
    }).success).toBe(true);
  });

  it.each(invalidPaths)('rejects unsafe ManagedFolderSummary.relativePath %s', (relativePath) => {
    expect(managedFolderSummarySchema.safeParse({
      folderId: 'folder-01',
      parentFolderId: null,
      name: 'unsafe',
      relativePath,
    }).success).toBe(false);
  });
});
