import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { McpPermissionPolicyStore } from '../../src/main/mcp-permission-policy-store';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('MCP access mode store', () => {
  it('defaults every credential to Auto and persists Full Access per credential', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-policy-'));
    roots.push(root);
    const store = new McpPermissionPolicyStore(root);
    const credentialA = '00000000-0000-4000-8000-000000000001';
    const credentialB = '00000000-0000-4000-8000-000000000002';

    expect(store.getMode(credentialA)).toBe('auto');
    store.setMode(credentialA, 'full-access');

    const reloaded = new McpPermissionPolicyStore(root);
    expect(reloaded.getMode(credentialA)).toBe('full-access');
    expect(reloaded.getMode(credentialB)).toBe('auto');
    expect(reloaded.snapshot(credentialA)).toEqual({ credentialId: credentialA, mode: 'full-access' });
  });

  it('switches back to Auto and clears a credential without affecting another', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-policy-'));
    roots.push(root);
    const store = new McpPermissionPolicyStore(root);
    const credentialA = '00000000-0000-4000-8000-000000000003';
    const credentialB = '00000000-0000-4000-8000-000000000004';

    store.setMode(credentialA, 'full-access');
    store.setMode(credentialB, 'full-access');
    store.setMode(credentialA, 'auto');
    expect(store.getMode(credentialA)).toBe('auto');
    expect(store.getMode(credentialB)).toBe('full-access');

    store.clearCredential(credentialB);
    expect(store.getMode(credentialB)).toBe('auto');
    expect(store.getMode(credentialA)).toBe('auto');
  });

  it('fails closed for invalid credential ids and ignores corrupted or legacy policy files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-policy-'));
    roots.push(root);
    writeFileSync(path.join(root, 'mcp-permission-policies.json'), '{not-json');

    const store = new McpPermissionPolicyStore(root);
    const credentialId = '00000000-0000-4000-8000-000000000005';
    expect(store.getMode(credentialId)).toBe('auto');
    expect(() => store.setMode('not-a-credential', 'full-access')).toThrow();

    writeFileSync(path.join(root, 'mcp-permission-policies.json'), JSON.stringify({
      version: 1,
      credentials: [{
        credentialId,
        policies: [{ capability: 'tag.write', policy: 'always-allow' }],
      }],
    }));
    expect(new McpPermissionPolicyStore(root).getMode(credentialId)).toBe('auto');
  });
});
