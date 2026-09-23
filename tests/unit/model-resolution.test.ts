import { describe, expect, it, vi } from 'vitest';

import { queryModelCompanionAssets } from '../../src/worker/model-resolution';

describe('model companion resolution', () => {
  it('canonicalizes safe extensions and drops oversized suffixes', () => {
    const all = vi.fn(() => [
      { asset_id: 'texture-1', relative_file_path: 'textures/Albedo.PNG', current_revision_id: 'rev-1' },
      { asset_id: 'material', relative_file_path: 'textures/material.mtl', current_revision_id: 'rev-2' },
      { asset_id: 'odd', relative_file_path: 'textures/file.this-extension-is-too-long', current_revision_id: 'rev-3' },
      { asset_id: 'unsupported', relative_file_path: 'textures/readme.txt', current_revision_id: 'rev-4' },
      { asset_id: 'missing-revision', relative_file_path: 'textures/mask.png', current_revision_id: null },
    ]);
    const connection = {
      prepare: vi.fn(() => ({ all })),
    };

    const result = queryModelCompanionAssets(connection, 'textures/model.obj');

    expect(connection.prepare).toHaveBeenCalledWith(expect.stringContaining('LIKE'));
    expect(all).toHaveBeenCalledWith('textures/%', 1_000);
    expect(result).toEqual([
      {
        assetId: 'texture-1',
        relativeFilePath: 'textures/Albedo.PNG',
        revisionId: 'rev-1',
        extension: '.png',
      },
      {
        assetId: 'material',
        relativeFilePath: 'textures/material.mtl',
        revisionId: 'rev-2',
        extension: '.mtl',
      },
    ]);
  });
});
