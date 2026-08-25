import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { McpClientCredentialStore, buildPepperFileAclArgs } from '../../src/main/mcp-client-credentials';

describe('MCP credential pepper ACL hardening (Serpent-8b5b.7)', () => {
  it('builds an inheritance-free, current-user-only icacls command shape', () => {
    expect(buildPepperFileAclArgs('/Users/testuser/AppData/Roaming/Serpent/pepper', 'testuser')).toEqual([
      '/Users/testuser/AppData/Roaming/Serpent/pepper',
      '/inheritance:r',
      '/grant:r',
      'testuser:F',
    ]);
  });

  it('never grants anything but the current user full control', () => {
    const args = buildPepperFileAclArgs('/tmp/pepper', 'alice');
    expect(args.some((part) => part.includes('Everyone'))).toBe(false);
    expect(args.some((part) => part.includes('Authenticated Users'))).toBe(false);
    expect(args.some((part) => part.includes('Users:'))).toBe(false);
    expect(args.filter((part) => part.endsWith(':F'))).toEqual(['alice:F']);
  });
});

describe('MCP credential token persistence', () => {
  it('keeps the client and token stable when copying it again', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-credential-persistence-'));
    try {
      const store = new McpClientCredentialStore(root);
      const issued = store.issue('Agent');
      const copied = store.tokenFor(issued.credentialId);

      expect(copied).toBe(issued.token);
      expect(store.authenticationState(issued.token)).toBe('valid');

      const reloaded = new McpClientCredentialStore(root);
      expect(reloaded.tokenFor(issued.credentialId)).toBe(issued.token);
      expect(reloaded.authenticationState(issued.token)).toBe('valid');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not return a missing or revoked credential token', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-mcp-credential-persistence-missing-'));
    try {
      const store = new McpClientCredentialStore(root);
      expect(store.tokenFor('00000000-0000-4000-8000-000000000000')).toBeUndefined();
      const issued = store.issue();
      expect(store.revoke(issued.credentialId)).toBe(true);
      expect(store.tokenFor(issued.credentialId)).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

});
