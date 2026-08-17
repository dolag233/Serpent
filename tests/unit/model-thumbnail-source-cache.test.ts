import { describe, expect, it } from 'vitest';

import {
  clearModelThumbnailSourceAuthorizations,
  registerModelThumbnailSourceAuthorizations,
  resolveModelThumbnailSourceAuthorization,
} from '../../src/main/model-thumbnail-source-cache';

describe('model thumbnail source authorization cache', () => {
  it('serves only the Worker-authorized revision tuple and clears it after render', () => {
    const authorization = {
      libraryId: 'library-1',
      assetId: 'asset-1',
      revisionId: 'revision-1',
      absolutePath: '/private/library/asset.obj',
      mimeType: 'model/obj',
    };

    registerModelThumbnailSourceAuthorizations([authorization]);
    expect(resolveModelThumbnailSourceAuthorization(authorization)).toEqual(authorization);
    expect(
      resolveModelThumbnailSourceAuthorization({
        ...authorization,
        revisionId: 'stale-revision',
      }),
    ).toBeUndefined();

    clearModelThumbnailSourceAuthorizations([authorization]);
    expect(resolveModelThumbnailSourceAuthorization(authorization)).toBeUndefined();
  });
});
