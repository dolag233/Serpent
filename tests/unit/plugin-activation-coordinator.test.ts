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
                  runtime: { mode: 'restricted', entry: 'dist/main.js' },
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
                runtime: { mode: 'restricted', entry: 'dist/main.js' },
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
                  runtime: { mode: 'restricted', entry: 'dist/main.js' },
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
                runtime: { mode: 'restricted', entry: 'dist/main.js' },
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

  it('deactivates unrestricted plugins under Safe Mode while keeping restricted activation available', async () => {
    const trustedDeactivate = vi.fn();
    const trustedActivate = vi.fn(async () => undefined);
    const standardActivate = vi.fn(async () => undefined);
    let safeMode = false;
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => safeMode,
        listInstalled: async () => [{
          status: 'valid',
          package: {
            lock: { pluginId: 'com.example.mixed', version: '1.0.0', packageHash: 'a'.repeat(64) },
            manifest: {
              id: 'com.example.mixed',
              name: 'Mixed',
              version: '1.0.0',
              engines: { serpent: '>=0.1.0', pluginApi: 1 },
              runtime: { mode: 'unrestricted', entry: 'dist/main.js' },
              permissions: ['library.read'],
            },
            packageDirectory: '/plugins/trusted',
          },
        }, {
          status: 'valid',
          package: {
            lock: { pluginId: 'com.example.restricted', version: '1.0.0', packageHash: 'b'.repeat(64) },
            manifest: {
              id: 'com.example.restricted',
              name: 'Restricted',
              version: '1.0.0',
              engines: { serpent: '>=0.1.0', pluginApi: 1 },
              runtime: { mode: 'restricted', entry: 'dist/main.js' },
              permissions: ['library.read'],
            },
            packageDirectory: '/plugins/standard',
          },
        }],
        resolve: async ({ pluginId }: { pluginId: string }) => {
          if (pluginId === 'com.example.mixed') {
            if (safeMode) return { status: 'disabled', reason: 'safe-mode' };
            return {
              status: 'resolved',
              selection: 'use-global',
              package: {
                lock: { pluginId: 'com.example.mixed', version: '1.0.0', packageHash: 'a'.repeat(64) },
                manifest: {
                  id: 'com.example.mixed',
                  name: 'Mixed',
                  version: '1.0.0',
                  engines: { serpent: '>=0.1.0', pluginApi: 1 },
                  runtime: { mode: 'unrestricted', entry: 'dist/main.js' },
                  permissions: ['library.read'],
                },
                packageDirectory: '/plugins/trusted',
              },
            };
          }
          return {
            status: 'resolved',
            selection: 'use-global',
            package: {
              lock: { pluginId: 'com.example.restricted', version: '1.0.0', packageHash: 'b'.repeat(64) },
              manifest: {
                id: 'com.example.restricted',
                name: 'Restricted',
                version: '1.0.0',
                engines: { serpent: '>=0.1.0', pluginApi: 1 },
                runtime: { mode: 'restricted', entry: 'dist/main.js' },
                permissions: ['library.read'],
              },
              packageDirectory: '/plugins/standard',
            },
          };
        },
      } as never,
      supervisor: {
        activate: standardActivate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      trustedSupervisor: {
        activate: trustedActivate,
        deactivate: trustedDeactivate,
        deactivateLibrary: vi.fn(),
      } as never,
      readEntryFile: async () => 'async function activate() {}',
      compatibility: {
        serpentVersion: '0.2.0',
        pluginApiVersion: 1,
        platform: 'darwin',
        arch: 'arm64',
        nodeAbi: 135,
      },
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    expect(trustedActivate).toHaveBeenCalledTimes(1);
    expect(standardActivate).toHaveBeenCalledTimes(1);
    expect(coordinator.trackedOpenLibraryIds()).toEqual(['library-1']);

    safeMode = true;
    await coordinator.refreshLibrary({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    expect(trustedDeactivate).toHaveBeenCalledWith(expect.any(String), 'safe-mode');
    expect(standardActivate).toHaveBeenCalledTimes(1);
  });

  it('activates trusted plugins through the dedicated supervisor', async () => {
    const trustedActivate = vi.fn(async () => undefined);
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async () => [{
          status: 'valid',
          package: {
            lock: { pluginId: 'com.example.trusted-node', version: '1.0.0', packageHash: 'd'.repeat(64) },
            manifest: {
              id: 'com.example.trusted-node',
              name: 'Trusted',
              version: '1.0.0',
              engines: { serpent: '>=0.1.0', pluginApi: 1 },
              runtime: { mode: 'unrestricted', entry: 'dist/main.js' },
              permissions: ['library.read', 'asset.read', 'net.fetch'],
            },
            packageDirectory: '/plugins/trusted-node',
          },
        }],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-global',
          package: {
            lock: { pluginId: 'com.example.trusted-node', version: '1.0.0', packageHash: 'd'.repeat(64) },
            manifest: {
              id: 'com.example.trusted-node',
              name: 'Trusted',
              version: '1.0.0',
              engines: { serpent: '>=0.1.0', pluginApi: 1 },
              runtime: { mode: 'unrestricted', entry: 'dist/main.js' },
              permissions: ['library.read', 'asset.read', 'net.fetch'],
            },
            packageDirectory: '/plugins/trusted-node',
          },
        }),
      } as never,
      supervisor: {
        activate: vi.fn(),
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      trustedSupervisor: {
        activate: trustedActivate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      compatibility: {
        serpentVersion: '0.2.0',
        pluginApiVersion: 1,
        platform: 'darwin',
        arch: 'arm64',
        nodeAbi: 135,
      },
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });

    expect(trustedActivate).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: 'com.example.trusted-node',
      packageDirectory: '/plugins/trusted-node',
      entryRelativePath: 'dist/main.js',
    }));
  });

  it('skips trusted plugins whose native modules do not match the current ABI', async () => {
    const trustedActivate = vi.fn(async () => undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async () => [{
          status: 'valid',
          package: {
            lock: { pluginId: 'com.example.native', version: '1.0.0', packageHash: 'e'.repeat(64) },
            manifest: {
              id: 'com.example.native',
              name: 'Native',
              version: '1.0.0',
              engines: { serpent: '>=0.1.0', pluginApi: 1 },
              runtime: {
                mode: 'unrestricted',
                entry: 'dist/main.js',
                nativeModules: [{ platform: 'darwin', arch: 'arm64', nodeAbi: 120 }],
              },
              permissions: ['library.read'],
            },
            packageDirectory: '/plugins/native',
          },
        }],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-global',
          package: {
            lock: { pluginId: 'com.example.native', version: '1.0.0', packageHash: 'e'.repeat(64) },
            manifest: {
              id: 'com.example.native',
              name: 'Native',
              version: '1.0.0',
              engines: { serpent: '>=0.1.0', pluginApi: 1 },
              runtime: {
                mode: 'unrestricted',
                entry: 'dist/main.js',
                nativeModules: [{ platform: 'darwin', arch: 'arm64', nodeAbi: 120 }],
              },
              permissions: ['library.read'],
            },
            packageDirectory: '/plugins/native',
          },
        }),
      } as never,
      supervisor: {
        activate: vi.fn(),
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      trustedSupervisor: {
        activate: trustedActivate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      compatibility: {
        serpentVersion: '0.2.0',
        pluginApiVersion: 1,
        platform: 'darwin',
        arch: 'arm64',
        nodeAbi: 135,
      },
      logger,
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });

    expect(trustedActivate).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'plugin.activation.compatibility',
      expect.any(Error),
      expect.objectContaining({
        pluginId: 'com.example.native',
        code: 'PLUGIN_PLATFORM_UNSUPPORTED',
      }),
    );
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
              runtime: { mode: 'restricted', entry: 'dist/main.js' },
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
              runtime: { mode: 'restricted', entry: 'dist/main.js' },
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
    expect(activate).toHaveBeenCalledTimes(0);

    coordinator.onLibraryClosed('library-1');
    activate.mockClear();
    await coordinator.refreshOpenLibraries();
    expect(activate).toHaveBeenCalledTimes(0);
  });

  it('registers manifest contributions on activate and revokes them on library close', async () => {
    const { createContributionRegistry } = await import('../../src/plugins/plugin-contributions');
    const contributions = createContributionRegistry();
    const deactivateLibrary = vi.fn();
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async () => [{
          status: 'valid',
          package: {
            lock: { pluginId: 'com.example.contrib', version: '1.0.0', packageHash: 'f'.repeat(64) },
            manifest: {
              runtime: { mode: 'restricted', entry: 'dist/main.js' },
              permissions: ['library.read', 'asset.read'],
              contributes: {
                commands: [{ id: 'do-thing', title: 'Do thing' }],
                menus: { asset: [{ command: 'do-thing' }] },
                views: [{ id: 'board', title: 'Board', location: 'workspace' }],
                settings: [],
                hooks: [],
                providers: [],
              },
            },
            packageDirectory: '/plugins/contrib',
          },
        }],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-library',
          package: {
            lock: { pluginId: 'com.example.contrib', version: '1.0.0', packageHash: 'f'.repeat(64) },
            manifest: {
              runtime: { mode: 'restricted', entry: 'dist/main.js' },
              permissions: ['library.read', 'asset.read'],
              contributes: {
                commands: [{ id: 'do-thing', title: 'Do thing' }],
                menus: { asset: [{ command: 'do-thing' }] },
                views: [{ id: 'board', title: 'Board', location: 'workspace' }],
                settings: [],
                hooks: [],
                providers: [],
              },
            },
            packageDirectory: '/plugins/contrib',
          },
        }),
      } as never,
      supervisor: {
        activate: vi.fn(async () => undefined),
        deactivate: vi.fn(),
        deactivateLibrary,
      } as never,
      contributions,
      readEntryFile: async () => 'async function activate() {}',
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    expect(contributions.list().map((entry) => entry.id).sort()).toEqual([
      'com.example.contrib.board',
      'com.example.contrib.do-thing',
      'com.example.contrib.menu.asset.do-thing',
    ]);

    // listContributions must match by instanceId (active map is keyed by pluginId).
    const listedMenus = coordinator.listContributions({
      libraryId: 'library-1',
      target: 'menus.asset',
    });
    expect(listedMenus).toEqual([expect.objectContaining({
      kind: 'menu',
      id: 'com.example.contrib.menu.asset.do-thing',
      pluginId: 'com.example.contrib',
      commandId: 'do-thing',
      target: 'menus.asset',
    })]);
    expect(listedMenus[0]?.pluginInstanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(coordinator.listContributions({
      libraryId: 'library-1',
      target: 'workspace.views',
    })).toEqual([expect.objectContaining({
      id: 'com.example.contrib.board',
      pluginId: 'com.example.contrib',
    })]);

    coordinator.onLibraryClosed('library-1');
    expect(contributions.list()).toEqual([]);
    expect(coordinator.listContributions({ libraryId: 'library-1' })).toEqual([]);
    expect(deactivateLibrary).toHaveBeenCalledWith('library-1', 'library-closed');
  });
});
