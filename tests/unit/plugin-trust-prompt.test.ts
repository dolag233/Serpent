import { describe, expect, it } from 'vitest';

import {
  collectPendingLibraryPluginTrust,
  dismissPendingLibraryPluginTrust,
  filterUndismissedPendingLibraryPlugins,
  pendingLibraryPluginTrustKey,
} from '../../src/renderer/plugin-trust-prompt';
import type {
  PluginManagerPackageSummary,
  PluginManagerResolutionSummary,
} from '../../src/shared/plugin-manager-api';

function libraryPackage(
  overrides: Partial<PluginManagerPackageSummary> & Pick<PluginManagerPackageSummary, 'pluginId' | 'packageHash'>,
): PluginManagerPackageSummary {
  return {
    version: '1.0.0',
    name: 'Demo Plugin',
    description: 'demo',
    runtimeMode: 'standard',
    permissions: ['library.read'],
    source: { kind: 'local-directory' },
    scope: 'library',
    status: 'valid',
    trust: 'untrusted',
    ...overrides,
  };
}

describe('plugin trust prompt collection', () => {
  it('collects awaiting-trust library plugins and ignores denied or user-scope packages', () => {
    const packages: PluginManagerPackageSummary[] = [
      libraryPackage({
        pluginId: 'com.example.a',
        packageHash: 'a'.repeat(64),
        name: 'Alpha',
      }),
      libraryPackage({
        pluginId: 'com.example.b',
        packageHash: 'b'.repeat(64),
        name: 'Bravo',
        trust: 'denied',
      }),
      {
        ...libraryPackage({
          pluginId: 'com.example.user',
          packageHash: 'c'.repeat(64),
          name: 'User Scope',
        }),
        scope: 'user',
      },
    ];
    const resolutions: PluginManagerResolutionSummary[] = [
      {
        status: 'awaiting-trust',
        pluginId: 'com.example.a',
        version: '1.0.0',
        packageHash: 'a'.repeat(64),
        selection: 'use-library',
        reason: 'untrusted',
      },
      {
        status: 'awaiting-trust',
        pluginId: 'com.example.b',
        version: '1.0.0',
        packageHash: 'b'.repeat(64),
        selection: 'use-library',
        reason: 'denied',
      },
      {
        status: 'resolved',
        pluginId: 'com.example.user',
        version: '1.0.0',
        packageHash: 'c'.repeat(64),
        selection: 'use-global',
      },
    ];

    expect(collectPendingLibraryPluginTrust({ packages, resolutions })).toEqual([
      {
        pluginId: 'com.example.a',
        name: 'Alpha',
        description: 'demo',
        version: '1.0.0',
        packageHash: 'a'.repeat(64),
        runtimeMode: 'standard',
        permissions: ['library.read'],
      },
    ]);
  });

  it('session-dismisses Later so the same packages are filtered until storage clears', () => {
    const storage = (() => {
      const map = new Map<string, string>();
      return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => {
          map.set(key, value);
        },
        removeItem: (key: string) => {
          map.delete(key);
        },
        clear: () => {
          map.clear();
        },
        key: () => null,
        get length() {
          return map.size;
        },
      } satisfies Storage;
    })();

    const pending = collectPendingLibraryPluginTrust({
      packages: [
        libraryPackage({
          pluginId: 'com.example.a',
          packageHash: 'a'.repeat(64),
          name: 'Alpha',
        }),
      ],
      resolutions: [
        {
          status: 'awaiting-trust',
          pluginId: 'com.example.a',
          version: '1.0.0',
          packageHash: 'a'.repeat(64),
          selection: 'use-library',
          reason: 'untrusted',
        },
      ],
    });

    expect(filterUndismissedPendingLibraryPlugins('library-1', pending, storage)).toHaveLength(1);
    dismissPendingLibraryPluginTrust('library-1', pending, storage);
    expect(filterUndismissedPendingLibraryPlugins('library-1', pending, storage)).toHaveLength(0);
    expect(pendingLibraryPluginTrustKey(pending[0]!)).toBe(`com.example.a:${'a'.repeat(64)}`);
  });
});
