import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAutomationCommandDescriptor,
  type AutomationCommandDescriptor,
} from '../../src/automation/command-registry';
import type { AutomationExecutionContext } from '../../src/automation/command-gateway';
import { McpPermissionBroker } from '../../src/main/mcp-permission-broker';
import { McpPermissionPolicyStore } from '../../src/main/mcp-permission-policy-store';
import { McpOperationChallengeStore } from '../../src/main/mcp-operation-challenge';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function policyStore(): McpPermissionPolicyStore {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-broker-'));
  roots.push(root);
  return new McpPermissionPolicyStore(root);
}

function createBroker(options: { policyStore: McpPermissionPolicyStore; audit?: { info: (scope: string, message: string, context?: Record<string, unknown>) => void } }): McpPermissionBroker {
  return new McpPermissionBroker({ ...options, challengeStore: new McpOperationChallengeStore() });
}

function context(overrides: Partial<AutomationExecutionContext> = {}): AutomationExecutionContext {
  return {
    executionId: 'execution-1',
    source: 'mcp',
    clientCredentialId: '00000000-0000-4000-8000-000000000001',
    clientName: 'Test client',
    libraryId: 'library-1',
    grantedCapabilities: ['library.read', 'tag.read'],
    ...overrides,
  };
}

function descriptor(commandId: 'tag.create' | 'asset.rename-file' | 'asset.delete-permanent'): AutomationCommandDescriptor {
  const value = getAutomationCommandDescriptor(commandId);
  if (value === undefined) throw new Error(`Missing test descriptor ${commandId}`);
  return value;
}

describe('MCP permission broker', () => {
  it('allows ordinary and recoverable operations in Auto without a human prompt', async () => {
    const store = policyStore();
    const audit = vi.fn();
    const broker = createBroker({ policyStore: store, audit: { info: audit } });

    await expect(broker.authorize({
      context: context(),
      descriptor: descriptor('tag.create'),
      commandInput: { name: 'tag' },
    })).resolves.toEqual({ allowed: true, scope: 'already-granted' });
    expect(audit).toHaveBeenCalledWith('mcp.permission.auto', expect.any(String), expect.objectContaining({
      credentialId: '00000000-0000-4000-8000-000000000001',
      commandId: 'tag.create',
      mode: 'auto',
      capabilities: ['tag.write'],
    }));
  });

  it('treats Full Access as a credential mode rather than a session grant', async () => {
    const store = policyStore();
    const credentialId = '00000000-0000-4000-8000-000000000001';
    store.setMode(credentialId, 'full-access');
    const broker = createBroker({ policyStore: store });

    await expect(broker.authorize({
      context: context(),
      descriptor: descriptor('asset.rename-file'),
      commandInput: { assetId: '00000000-0000-4000-8000-000000000010', newName: 'renamed.png' },
    })).resolves.toEqual({ allowed: true, scope: 'always-allow' });
    await expect(broker.authorize({
      context: context({ executionId: 'another-transport-execution' }),
      descriptor: descriptor('asset.rename-file'),
      commandInput: { assetId: '00000000-0000-4000-8000-000000000010', newName: 'renamed-again.png' },
    })).resolves.toEqual({ allowed: true, scope: 'always-allow' });
  });

  it('does not grant MCP capabilities when the credential is missing', async () => {
    const broker = createBroker({ policyStore: policyStore() });

    await expect(broker.authorize({
      context: context({ clientCredentialId: undefined }),
      descriptor: descriptor('tag.create'),
      commandInput: { name: 'tag' },
    })).resolves.toEqual({ allowed: false, reason: 'denied' });
  });

  it('returns cancellation before authorizing a command', async () => {
    const controller = new AbortController();
    controller.abort();
    const broker = createBroker({ policyStore: policyStore() });

    await expect(broker.authorize({
      context: context(),
      descriptor: descriptor('tag.create'),
      commandInput: { name: 'tag' },
      signal: controller.signal,
    })).resolves.toEqual({ allowed: false, reason: 'cancelled' });
  });

  it('keeps permission cleanup APIs as no-ops for transport-session compatibility', async () => {
    const store = policyStore();
    const credentialId = '00000000-0000-4000-8000-000000000001';
    store.setMode(credentialId, 'full-access');
    const broker = createBroker({ policyStore: store });

    broker.clearExecution();
    broker.clearCapability();
    await expect(broker.authorize({
      context: context(),
      descriptor: descriptor('tag.create'),
      commandInput: { name: 'tag' },
    })).resolves.toEqual({ allowed: true, scope: 'always-allow' });
  });

  it('audits only redacted command metadata', async () => {
    const events: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const broker = createBroker({
      policyStore: policyStore(),
      audit: { info: (scope, _message, eventContext) => events.push({ scope, context: eventContext }) },
    });

    await broker.authorize({
      context: context({ clientName: 'Redacted client' }),
      descriptor: descriptor('tag.create'),
      commandInput: { name: 'secret', path: '/private/should-not-be-logged' },
    });

    expect(events).toEqual([{
      scope: 'mcp.permission.auto',
      context: {
        credentialId: '00000000-0000-4000-8000-000000000001',
        commandId: 'tag.create',
        mode: 'auto',
        capabilities: ['tag.write'],
      },
    }]);
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(JSON.stringify(events)).not.toContain('/private');
  });
});

describe('MCP dangerous operation challenge (Serpent-8b5b.2)', () => {
  const credentialId = '00000000-0000-4000-8000-000000000001';

  function criticalContext(overrides: Partial<AutomationExecutionContext> = {}): AutomationExecutionContext {
    return context({
      clientCredentialId: credentialId,
      libraryId: 'library-1',
      contextRevision: 7,
      ...overrides,
    });
  }

  it('never executes on the first call and issues a bound risk report', async () => {
    const audit = vi.fn();
    const broker = createBroker({ policyStore: policyStore(), audit: { info: audit } });
    const authorization = await broker.authorize({
      context: criticalContext(),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: { libraryId: 'library-1', assetIds: ['asset-1', 'asset-2'] },
    });
    expect(authorization).toMatchObject({
      allowed: false,
      reason: 'challenge-required',
      challenge: {
        status: 'confirmation-required',
        operation: 'asset.delete-permanent',
        severity: 'dangerous',
        affectedCount: 2,
        recovery: 'none',
      },
    });
    if (!('challenge' in authorization)) throw new Error('expected challenge');
    expect(authorization.challenge.challengeId).toBeTruthy();
    expect(authorization.challenge.expiresAt > new Date().toISOString()).toBe(true);
    expect(audit).toHaveBeenCalledWith(
      'mcp.permission.challenge-issued',
      expect.any(String),
      expect.objectContaining({ commandId: 'asset.delete-permanent', targetCount: 2 }),
    );
  });

  it('consumes the exact second call exactly once and audits it', async () => {
    const audit = vi.fn();
    const broker = createBroker({ policyStore: policyStore(), audit: { info: audit } });
    const first = await broker.authorize({
      context: criticalContext(),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: { libraryId: 'library-1', assetIds: ['asset-1'] },
    });
    if (!('challenge' in first)) throw new Error('expected challenge');

    const confirmed = await broker.authorize({
      context: criticalContext(),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: {
        libraryId: 'library-1',
        assetIds: ['asset-1'],
        challengeId: first.challenge.challengeId,
        planHash: first.challenge.planHash,
        acknowledged: true,
        idempotencyKey: 'delete-1',
      },
    });
    expect(confirmed).toEqual({ allowed: true, scope: 'challenge-confirmed', challengeConsumed: true });
    expect(audit).toHaveBeenCalledWith(
      'mcp.permission.challenge-confirmed',
      expect.any(String),
      expect.objectContaining({ commandId: 'asset.delete-permanent', targetCount: 1 }),
    );

    // Replay of the same challenge must be rejected and re-issue a fresh report.
    const replayed = await broker.authorize({
      context: criticalContext(),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: {
        libraryId: 'library-1',
        assetIds: ['asset-1'],
        challengeId: first.challenge.challengeId,
        planHash: first.challenge.planHash,
        acknowledged: true,
        idempotencyKey: 'delete-1',
      },
    });
    expect(replayed).toMatchObject({ allowed: false, reason: 'challenge-required' });
    if (!('challenge' in replayed)) throw new Error('expected challenge');
    expect(replayed.challenge.challengeId).not.toBe(first.challenge.challengeId);
  });

  it('rejects tampered arguments, cross-client use and state changes', async () => {
    const broker = createBroker({ policyStore: policyStore() });
    const first = await broker.authorize({
      context: criticalContext(),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: { libraryId: 'library-1', assetIds: ['asset-1'] },
    });
    if (!('challenge' in first)) throw new Error('expected challenge');
    const base = {
      challengeId: first.challenge.challengeId,
      planHash: first.challenge.planHash,
      acknowledged: true,
      idempotencyKey: 'delete-1',
    };

    // Tampered target set.
    const tampered = await broker.authorize({
      context: criticalContext(),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: { libraryId: 'library-1', assetIds: ['asset-2'], ...base },
    });
    expect(tampered).toMatchObject({ allowed: false, reason: 'challenge-required' });

    // Cross-client: different credential.
    const crossClient = await broker.authorize({
      context: criticalContext({ clientCredentialId: '00000000-0000-4000-8000-000000000002' }),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: { libraryId: 'library-1', assetIds: ['asset-1'], ...base },
    });
    expect(crossClient).toMatchObject({ allowed: false, reason: 'challenge-required' });

    // State changed: library context revision moved.
    const stateChanged = await broker.authorize({
      context: criticalContext({ contextRevision: 8 }),
      descriptor: descriptor('asset.delete-permanent'),
      commandInput: { libraryId: 'library-1', assetIds: ['asset-1'], ...base },
    });
    expect(stateChanged).toMatchObject({ allowed: false, reason: 'challenge-required' });
  });
});
