import { expect, it, vi } from 'vitest';

import { collectLinkedAssetPaths } from '../../src/worker/linked-asset-path-projection';

it('aggregates ancestors across keyset pages and yields between pages', async () => {
  const firstPage = Array.from({ length: 2_048 }, (_, n) => `plants/fern/image-${n}.png`);
  const read = vi.fn((after: string | null) => after === null ? firstPage : ['plants/moss/image.png']);
  const checkpoint = vi.fn(async () => {});
  const result = await collectLinkedAssetPaths(read, checkpoint);
  expect(read.mock.calls.map(([after]) => after)).toEqual([null, firstPage.at(-1)]);
  expect(checkpoint).toHaveBeenCalledTimes(2);
  expect(result.paths).toHaveLength(2_049);
  expect(result.counts.get('plants')).toEqual({ direct: 0, recursive: 2_049 });
  expect(result.counts.get('plants/fern')).toEqual({ direct: 2_048, recursive: 2_048 });
});

it('stops reading when the library lifecycle checkpoint cancels', async () => {
  const read = vi.fn(() => Array.from({ length: 2_048 }, (_, n) => `image-${n}.png`));
  await expect(collectLinkedAssetPaths(read, async () => { throw new Error('closed'); })).rejects.toThrow('closed');
  expect(read).toHaveBeenCalledTimes(1);
});
