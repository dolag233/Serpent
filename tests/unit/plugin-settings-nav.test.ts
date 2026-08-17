import { describe, expect, it } from 'vitest';

import { collectPluginSettingsNavEntries } from '../../src/renderer/plugin-settings-detail';
import type { PluginManagerPackageSummary } from '../../src/shared/plugin-manager-api';

function pkg(
  overrides: Partial<PluginManagerPackageSummary> & Pick<PluginManagerPackageSummary, 'pluginId' | 'name'>,
): PluginManagerPackageSummary {
  return {
    version: '1.0.0',
    description: 'demo',
    packageHash: 'a'.repeat(64),
    runtimeMode: 'restricted',
    permissions: [],
    source: { kind: 'local-directory' },
    sourceFingerprint: 'local:demo',
    scope: 'user',
    status: 'valid',
    trust: 'trusted',
    hasSettingsUi: false,
    ...overrides,
  };
}

describe('collectPluginSettingsNavEntries', () => {
  it('includes packages with host settings or settings pages', () => {
    const entries = collectPluginSettingsNavEntries(
      [
        pkg({ pluginId: 'com.example.a', name: 'Alpha', hasSettingsUi: true }),
        pkg({ pluginId: 'com.example.b', name: 'Bravo' }),
        pkg({ pluginId: 'com.example.c', name: 'Charlie' }),
      ],
      ['com.example.c'],
      new Map([['com.example.c', 'Charlie page']]),
    );
    expect(entries.map((entry) => entry.pluginId)).toEqual([
      'com.example.a',
      'com.example.c',
    ]);
  });
});
