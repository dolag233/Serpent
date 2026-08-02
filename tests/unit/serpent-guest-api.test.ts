import { describe, expect, it, vi } from 'vitest';

import { createSerpentGuestApi } from '../../src/scripting/serpent-guest-api';

describe('Serpent Guest API library scopes', () => {
  it('creates an immutable forLibrary scope without changing ambient calls', async () => {
    const executeCommand = vi.fn(async () => ({ items: [] }));
    const serpent = createSerpentGuestApi({ executeCommand });

    await serpent.assets!.list!();
    const scoped = serpent.forLibrary('library-2');
    await scoped.assets!.list!();
    await serpent.assets!.list!();

    expect(executeCommand).toHaveBeenNthCalledWith(1, 'asset.list', {}, undefined);
    expect(executeCommand).toHaveBeenNthCalledWith(2, 'asset.list', {}, {
      targetLibraryId: 'library-2',
    });
    expect(executeCommand).toHaveBeenNthCalledWith(3, 'asset.list', {}, undefined);
    expect(() => serpent.forLibrary('../outside')).toThrow('Invalid target library id.');
    expect(() => serpent.forLibrary('library/other')).toThrow('Invalid target library id.');
  });

  it('does not expose a mutable target on the scoped command API', () => {
    const serpent = createSerpentGuestApi({ executeCommand: async () => undefined });
    const scoped = serpent.forLibrary('library-2');

    expect(scoped).not.toHaveProperty('forLibrary');
    expect(Object.isFrozen(scoped)).toBe(false);
  });
});
