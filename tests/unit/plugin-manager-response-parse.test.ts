import { describe, expect, it } from 'vitest';
import { parsePluginManagerResponse } from '../../src/shared/plugin-manager-api';

describe('plugin manager response parse', () => {
  it('parses empty success', () => {
    expect(parsePluginManagerResponse({
      ok: true,
      packages: [],
      resolutions: [],
      safeMode: false,
    })).toEqual({ ok: true, packages: [], resolutions: [], safeMode: false });
  });

  it('parses awaiting-trust resolution', () => {
    const hash = 'a'.repeat(64);
    expect(parsePluginManagerResponse({
      ok: true,
      packages: [{
        pluginId: 'com.example.palette-tools',
        version: '1.2.0',
        name: 'Palette Tools',
        description: 'Extract and organize asset palettes.',
        packageHash: hash,
        runtimeMode: 'standard',
        permissions: ['asset.read'],
        source: { kind: 'local-directory' },
        scope: 'library',
        status: 'valid',
        trust: 'untrusted',
      }],
      resolutions: [{
        status: 'awaiting-trust',
        pluginId: 'com.example.palette-tools',
        version: '1.2.0',
        packageHash: hash,
        selection: 'use-library',
        reason: 'untrusted',
      }],
      safeMode: false,
    }).ok).toBe(true);
  });

  it('parses quarantined disabled resolution', () => {
    const hash = 'b'.repeat(64);
    expect(parsePluginManagerResponse({
      ok: true,
      packages: [],
      resolutions: [{
        status: 'disabled',
        pluginId: 'com.example.palette-tools',
        reason: 'quarantined',
        version: '1.2.0',
        packageHash: hash,
      }],
      safeMode: false,
    }).ok).toBe(true);
  });
});
