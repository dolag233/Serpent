import { expect, it, vi } from 'vitest';

import { SingleFlightRead } from '../../src/worker/single-flight-read';

it('shares a cold read per key while keeping different versions independent', async () => {
  const reads = new SingleFlightRead<number>();
  let release!: (value: number) => void;
  const load = vi.fn(() => new Promise<number>((resolve) => { release = resolve; }));
  const first = reads.run('old', load);
  const second = reads.run('old', load);
  expect(first).toBe(second);
  await Promise.resolve();
  expect(load).toHaveBeenCalledTimes(1);
  expect(await reads.run('new', async () => 2)).toBe(2);
  release(1);
  expect(await first).toBe(1);
});

it('clears a failed read so the same key can recover', async () => {
  const reads = new SingleFlightRead<number>();
  await expect(reads.run('same', async () => { throw new Error('cancelled'); })).rejects.toThrow('cancelled');
  expect(await reads.run('same', async () => 3)).toBe(3);
});
