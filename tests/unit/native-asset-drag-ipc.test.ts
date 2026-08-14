import { describe, expect, it, vi } from 'vitest';

import { ASSET_NATIVE_DRAG_CHANNEL } from '../../src/shared/protocol/channels';
import { sendNativeAssetDrag } from '../../src/preload/native-asset-drag';

describe('native asset drag IPC', () => {
  it('uses one-way async IPC so dropping back into Serpent cannot deadlock', () => {
    const send = vi.fn();

    expect(sendNativeAssetDrag(
      { send },
      { libraryId: 'library-1', assetIds: ['asset-1'] },
    )).toBeUndefined();

    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(ASSET_NATIVE_DRAG_CHANNEL, {
      libraryId: 'library-1',
      assetIds: ['asset-1'],
    });
  });
});
