import { describe, expect, it } from 'vitest';

import { buildPepperFileAclArgs } from '../../src/main/mcp-client-credentials';

describe('MCP credential pepper ACL hardening (Serpent-8b5b.7)', () => {
  it('builds an inheritance-free, current-user-only icacls command shape', () => {
    expect(buildPepperFileAclArgs('/Users/dolag/AppData/Roaming/Serpent/pepper', 'dolag')).toEqual([
      '/Users/dolag/AppData/Roaming/Serpent/pepper',
      '/inheritance:r',
      '/grant:r',
      'dolag:F',
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
