import { describe, expect, it } from 'vitest';

import { McpOperationChallengeStore } from '../../src/main/mcp-operation-challenge';

const credentialId = '00000000-0000-4000-8000-000000000001';

function issue(store: McpOperationChallengeStore, overrides: Record<string, unknown> = {}) {
  return store.issue({
    credentialId,
    commandId: 'asset.delete-permanent',
    operation: 'asset.delete-permanent',
    summary: '从应用回收站永久删除所选资产；文件不进入磁盘回收站，不可恢复。',
    irreversibleEffects: ['从应用回收站永久删除所选资产；文件不进入磁盘回收站，不可恢复。'],
    targets: [{ id: 'asset-1' }, { id: 'asset-2' }],
    recovery: 'none',
    planHash: null,
    canonicalInput: { libraryId: 'library-1', assetIds: ['asset-1', 'asset-2'] },
    libraryId: 'library-1',
    contextRevision: 7,
    ...overrides,
  });
}

function consume(store: McpOperationChallengeStore, challengeId: string, overrides: Record<string, unknown> = {}) {
  return store.consume({
    challengeId,
    planHash: null,
    credentialId,
    commandId: 'asset.delete-permanent',
    canonicalInput: { libraryId: 'library-1', assetIds: ['asset-1', 'asset-2'] },
    libraryId: 'library-1',
    contextRevision: 7,
    ...overrides,
  });
}

describe('MCP operation challenge store (Serpent-8b5b.2)', () => {
  it('issues and consumes an exact call exactly once', () => {
    const store = new McpOperationChallengeStore();
    const challenge = issue(store);
    expect(consume(store, challenge.challengeId)).toEqual({ status: 'ok' });
    expect(consume(store, challenge.challengeId)).toEqual({ status: 'already-consumed' });
  });

  it('rejects tampered arguments, targets and command ids', () => {
    const store = new McpOperationChallengeStore();
    const challenge = issue(store);
    expect(consume(store, challenge.challengeId, {
      canonicalInput: { libraryId: 'library-1', assetIds: ['asset-2'] },
    })).toEqual({ status: 'tampered' });
    expect(consume(store, challenge.challengeId, {
      libraryId: 'library-2',
    })).toEqual({ status: 'tampered' });
    expect(consume(store, challenge.challengeId, {
      commandId: 'asset.delete-from-disk',
    })).toEqual({ status: 'tampered' });
    expect(consume(store, challenge.challengeId, {
      planHash: 'forged',
    })).toEqual({ status: 'tampered' });
    expect(consume(store, 'no-such-challenge')).toEqual({ status: 'tampered' });
  });

  it('rejects cross-client consumption', () => {
    const store = new McpOperationChallengeStore();
    const challenge = issue(store);
    expect(consume(store, challenge.challengeId, {
      credentialId: '00000000-0000-4000-8000-000000000002',
    })).toEqual({ status: 'cross-client' });
  });

  it('rejects a state change between issue and consume', () => {
    const store = new McpOperationChallengeStore();
    const challenge = issue(store);
    expect(consume(store, challenge.challengeId, {
      contextRevision: 8,
    })).toEqual({ status: 'state-changed' });
  });

  it('expires challenges after the TTL', () => {
    const store = new McpOperationChallengeStore();
    const now = new Date('2026-08-10T00:00:00.000Z');
    const challenge = issue(store, { now });
    expect(consume(store, challenge.challengeId, {
      now: new Date(now.getTime() + 10 * 60 * 1000),
    })).toEqual({ status: 'expired' });
  });

  it('clears challenges per credential and globally', () => {
    const store = new McpOperationChallengeStore();
    const a = issue(store, { credentialId: '00000000-0000-4000-8000-000000000001' });
    const b = issue(store, { credentialId: '00000000-0000-4000-8000-000000000002' });
    store.clearCredential('00000000-0000-4000-8000-000000000001');
    expect(consume(store, a.challengeId)).toEqual({ status: 'tampered' });
    expect(consume(store, b.challengeId, {
      credentialId: '00000000-0000-4000-8000-000000000002',
    })).toEqual({ status: 'ok' });
    store.clearAll();
    expect(consume(store, b.challengeId, {
      credentialId: '00000000-0000-4000-8000-000000000002',
    })).toEqual({ status: 'tampered' });
  });
});
