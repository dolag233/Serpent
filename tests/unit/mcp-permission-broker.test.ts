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

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function policyStore(): McpPermissionPolicyStore {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-broker-'));
  roots.push(root);
  return new McpPermissionPolicyStore(root);
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

function descriptor(commandId: 'tag.create' | 'asset.rename-file'): AutomationCommandDescriptor {
  const value = getAutomationCommandDescriptor(commandId);
  if (value === undefined) throw new Error(`Missing test descriptor ${commandId}`);
  return value;
}

describe('MCP permission broker', () => {
  it('allows ordinary and recoverable operations in Auto without a human prompt', async () => {
    const store = policyStore();
    const audit = vi.fn();
    const broker = new McpPermissionBroker({
      policyStore: store,
      audit: { info: audit },
    });

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
    const broker = new McpPermissionBroker({ policyStore: store });

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
    const broker = new McpPermissionBroker({ policyStore: policyStore() });

    await expect(broker.authorize({
      context: context({ clientCredentialId: undefined }),
      descriptor: descriptor('tag.create'),
      commandInput: { name: 'tag' },
    })).resolves.toEqual({ allowed: false, reason: 'denied' });
  });

  it('returns cancellation before authorizing a command', async () => {
    const controller = new AbortController();
    controller.abort();
    const broker = new McpPermissionBroker({ policyStore: policyStore() });

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
    const broker = new McpPermissionBroker({ policyStore: store });

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
    const broker = new McpPermissionBroker({
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
