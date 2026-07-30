import { describe, expect, it, vi } from 'vitest';

import { PluginActivationCoordinator } from '../../src/main/plugin-activation-coordinator';

describe('PluginActivationCoordinator', () => {
  it('activates only resolved standard plugins and skips awaiting-trust', async () => {
    const activate = vi.fn(async () => undefined);
    const deactivate = vi.fn();
    const deactivateLibrary = vi.fn();
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async ({ scope }: { scope: string }) => {
          if (scope === 'user') {
            return [{
              status: 'valid',
              package: {
                lock: { pluginId: 'com.example.trusted', version: '1.0.0', packageHash: 'b'.repeat(64) },
                manifest: {
                  runtime: { mode: 'standard', entry: 'dist/main.js' },
                  permissions: ['library.read', 'asset.read'],
                },
                packageDirectory: '/plugins/trusted',
              },
            }];
          }
          return [{
            status: 'valid',
            package: {
              lock: { pluginId: 'com.example.waiting', version: '1.0.0', packageHash: 'c'.repeat(64) },
              manifest: {
                runtime: { mode: 'standard', entry: 'dist/main.js' },
                permissions: ['library.read'],
              },
              packageDirectory: '/plugins/waiting',
            },
          }];
        },
        resolve: async ({ pluginId }: { pluginId: string }) => {
          if (pluginId === 'com.example.trusted') {
            return {
              status: 'resolved',
              selection: 'use-global',
              package: {
                lock: { pluginId, version: '1.0.0', packageHash: 'b'.repeat(64) },
                manifest: {
                  runtime: { mode: 'standard', entry: 'dist/main.js' },
                  permissions: ['library.read', 'asset.read'],
                },
                packageDirectory: '/plugins/trusted',
              },
            };
          }
          return {
            status: 'awaiting-trust',
            selection: 'use-library',
            package: {
              lock: { pluginId, version: '1.0.0', packageHash: 'c'.repeat(64) },
              manifest: {
                runtime: { mode: 'standard', entry: 'dist/main.js' },
                permissions: ['library.read'],
              },
              packageDirectory: '/plugins/waiting',
            },
            reason: 'untrusted',
          };
        },
      } as never,
      supervisor: {
        activate,
        deactivate,
        deactivateLibrary,
      } as never,
      readEntryFile: async () => 'async function activate() {}',
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'library-1',
      pluginId: 'com.example.trusted',
      entryJavaScript: 'async function activate() {}',
    }));
    expect(deactivate).not.toHaveBeenCalled();
  });

  it('deactivates the library when Safe Mode is enabled', async () => {
    const deactivateLibrary = vi.fn();
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => true,
        listInstalled: async () => [],
        resolve: async () => ({ status: 'not-installed' }),
      } as never,
      supervisor: {
        activate: vi.fn(),
        deactivate: vi.fn(),
        deactivateLibrary,
      } as never,
    });

    await coordinator.refreshLibrary({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    expect(deactivateLibrary).toHaveBeenCalledWith('library-1', 'safe-mode');
  });

  it('refreshOpenLibraries only touches libraries that were opened', async () => {
    const activate = vi.fn(async () => undefined);
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async () => [{
          status: 'valid',
          package: {
            lock: { pluginId: 'com.example.trusted', version: '1.0.0', packageHash: 'b'.repeat(64) },
            manifest: {
              runtime: { mode: 'standard', entry: 'dist/main.js' },
              permissions: ['library.read'],
            },
            packageDirectory: '/plugins/trusted',
          },
        }],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-global',
          package: {
            lock: { pluginId: 'com.example.trusted', version: '1.0.0', packageHash: 'b'.repeat(64) },
            manifest: {
              runtime: { mode: 'standard', entry: 'dist/main.js' },
              permissions: ['library.read'],
            },
            packageDirectory: '/plugins/trusted',
          },
        }),
      } as never,
      supervisor: {
        activate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      readEntryFile: async () => 'async function activate() {}',
    });

    await coordinator.refreshOpenLibraries();
    expect(activate).not.toHaveBeenCalled();

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    expect(activate).toHaveBeenCalledTimes(1);

    activate.mockClear();
    await coordinator.refreshOpenLibraries();
    // Already-active plugin ids are left running; refresh still walks open libraries.
    expect(activate).toHaveBeenCalledTimes(0);

    coordinator.onLibraryClosed('library-1');
    activate.mockClear();
    await coordinator.refreshOpenLibraries();
    expect(activate).toHaveBeenCalledTimes(0);
  });
});
