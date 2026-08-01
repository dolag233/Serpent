import { describe, expect, it } from 'vitest';

import {
  pluginCommandContextSchema,
  pluginCommandInvokeSchema,
} from '../../src/plugins/plugin-commands';

describe('plugin command context', () => {
  it('accepts optional asset, folder, and collection ids', () => {
    expect(pluginCommandContextSchema.parse({
      assetIds: ['asset-1'],
    })).toEqual({ assetIds: ['asset-1'] });
    expect(pluginCommandContextSchema.parse({
      folderIds: ['folder-1'],
    })).toEqual({ folderIds: ['folder-1'] });
    expect(pluginCommandContextSchema.parse({
      collectionIds: ['collection-1'],
    })).toEqual({ collectionIds: ['collection-1'] });
    expect(pluginCommandInvokeSchema.parse({
      invokeId: '11111111-1111-4111-8111-111111111111',
      commandId: 'probe.write-folder',
      context: { folderIds: ['folder-1'] },
    })).toMatchObject({
      commandId: 'probe.write-folder',
      context: { folderIds: ['folder-1'] },
    });
  });
});
