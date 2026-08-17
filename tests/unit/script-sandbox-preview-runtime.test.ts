import { describe, expect, it } from 'vitest';

import { SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES } from '../../src/shared/script-sandbox-limits';
import { DEFAULT_AUTOMATION_RATING_SCRIPT } from '../../src/renderer/script-sandbox-preview-default';
import { runScriptSandboxPreview } from '../../src/renderer/script-sandbox-preview-runtime';

describe('script sandbox preview worker runtime', () => {
  it('returns stable failures at the Worker runtime boundary', async () => {
    await expect(runScriptSandboxPreview({
      type: 'run',
      runId: 'import',
      source: `return import('node:fs');`,
    })).resolves.toMatchObject({ type: 'failed', code: 'SOURCE_NOT_ALLOWED' });

    await expect(runScriptSandboxPreview({
      type: 'run',
      runId: 'oversized',
      source: ' '.repeat(SCRIPT_SANDBOX_PREVIEW_MAX_SOURCE_BYTES + 1),
    })).resolves.toMatchObject({ type: 'failed', code: 'SOURCE_TOO_LARGE' });
  });

  it('paginates fixed asset searches and batches their ratings through the injected Gateway-only host', async () => {
    const commands: Array<{ commandId: string; input: unknown }> = [];
    await expect(runScriptSandboxPreview({
      type: 'run',
      runId: 'rating',
      source: DEFAULT_AUTOMATION_RATING_SCRIPT,
    }, {
      executeAutomationCommand: async (commandId, input) => {
        commands.push({ commandId, input });
        if (commandId === 'asset.search') {
          const request = input as { query: string; limit: number; offset: number };
          expect(request.query).toBe('name:Ser | tag:Ser');
          expect(request.limit).toBe(200);
          const total = 501;
          const end = Math.min(request.offset + request.limit, total);
          return {
            items: Array.from({ length: end - request.offset }, (_, index) => {
              const number = request.offset + index;
              return { assetId: `asset-${number}`, displayName: `Ser-${number}.png`, rating: 0 };
            }),
            total,
            offset: request.offset,
            limit: request.limit,
            hasMore: end < total,
          };
        }
        return { updatedCount: (input as { assetIds: string[] }).assetIds.length, skipped: [] };
      },
    })).resolves.toMatchObject({
      type: 'completed',
      value: { matched: 501, updatedCount: 501, skipped: [] },
      output: ['{"matched":501,"updatedCount":501,"skipped":[]}'],
    });
    const searchRequests = commands.filter((command) => command.commandId === 'asset.search');
    expect(searchRequests).toEqual([
      { commandId: 'asset.search', input: { query: 'name:Ser | tag:Ser', limit: 200, offset: 0 } },
      { commandId: 'asset.search', input: { query: 'name:Ser | tag:Ser', limit: 200, offset: 200 } },
      { commandId: 'asset.search', input: { query: 'name:Ser | tag:Ser', limit: 200, offset: 400 } },
    ]);
    const ratingRequests = commands.filter((command) => command.commandId === 'asset.rating.set');
    expect(ratingRequests).toHaveLength(2);
    expect(ratingRequests.map((command) => (command.input as { assetIds: string[] }).assetIds.length))
      .toEqual([500, 1]);
    expect((ratingRequests[0]?.input as { assetIds: string[] }).assetIds)
      .toEqual(expect.arrayContaining(['asset-0', 'asset-499']));
    expect((ratingRequests[1]?.input as { assetIds: string[] }).assetIds)
      .toEqual(['asset-500']);
  });
});
