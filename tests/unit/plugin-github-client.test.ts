import { describe, expect, it, vi } from 'vitest';

import { createGitHubPluginClient } from '../../src/main/plugin-github-client';

describe('GitHub plugin client downloads', () => {
  it('streams release bytes and reports progress without exposing a path', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-length': '4' },
    }));
    const progress: Array<{ bytesDownloaded: number; totalBytes?: number }> = [];
    const archive = await createGitHubPluginClient(fetchImpl).downloadReleaseAsset(
      'https://github.com/owner/repo/releases/download/v1/plugin.zip',
      { onProgress: (event) => progress.push(event) },
    );
    expect([...archive]).toEqual([1, 2, 3, 4]);
    expect(progress.at(-1)).toEqual({ bytesDownloaded: 4, totalBytes: 4 });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://github.com/owner/repo/releases/download/v1/plugin.zip',
      expect.objectContaining({ redirect: 'follow' }),
    );
  });
});
