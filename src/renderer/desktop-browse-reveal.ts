export type DesktopRevealAsset = {
  readonly assetId: string;
  readonly locationKind: 'managed' | 'linked';
  readonly managedFolderId: string | null;
  readonly available: boolean;
};

export type DesktopRevealResolution =
  | { readonly status: 'visible'; readonly assetId: string }
  | {
      readonly status: 'switch-folder';
      readonly assetId: string;
      readonly folderId: string;
    }
  | { readonly status: 'not-found'; readonly assetId: string }
  | { readonly status: 'unavailable'; readonly assetId: string }
  | { readonly status: 'unsupported-scope'; readonly assetId: string };

export function resolveDesktopReveal(input: {
  readonly assetId: string;
  readonly currentBrowseTarget: 'all' | 'root' | 'folder' | 'trash' | 'tag' | 'collection' | 'smart-collection';
  readonly currentFolderId: string | null;
  readonly assets: readonly DesktopRevealAsset[];
}): DesktopRevealResolution {
  const asset = input.assets.find((candidate) => candidate.assetId === input.assetId);
  if (asset === undefined) {
    return { status: 'not-found', assetId: input.assetId };
  }
  if (!asset.available) {
    return { status: 'unavailable', assetId: input.assetId };
  }
  if (asset.locationKind !== 'managed') {
    return { status: 'unsupported-scope', assetId: input.assetId };
  }
  if (
    input.currentBrowseTarget === 'folder'
    && input.currentFolderId !== asset.managedFolderId
  ) {
    return asset.managedFolderId === null
      ? { status: 'visible', assetId: input.assetId }
      : {
          status: 'switch-folder',
          assetId: input.assetId,
          folderId: asset.managedFolderId,
        };
  }
  return { status: 'visible', assetId: input.assetId };
}
