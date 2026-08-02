import { describe, expect, it, vi } from 'vitest';

import { PluginActivationCoordinator } from '../../src/main/plugin-activation-coordinator';

describe('PluginActivationCoordinator', () => {
  it('stages a library instance before setup can call back into Host state', async () => {
    const coordinatorRef: { current?: PluginActivationCoordinator } = {};
    const activate = vi.fn(async () => {
      expect(coordinatorRef.current?.listActiveInstances('library-1')).toEqual([
        expect.objectContaining({ pluginId: 'com.example.setup-callback' }),
      ]);
    });
    const pluginPackage = {
      scope: 'library' as const,
      lock: { pluginId: 'com.example.setup-callback', version: '1.0.0', packageHash: 'a'.repeat(64) },
      manifest: {
        runtime: { mode: 'restricted' as const, entry: 'dist/main.js' },
        permissions: ['library.read' as const],
      },
      packageDirectory: '/plugins/setup-callback',
    };

    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async ({ scope }: { scope: string }) => scope === 'library'
          ? [{ status: 'valid', package: pluginPackage }]
          : [],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-library',
          package: pluginPackage,
        }),
      } as never,
      supervisor: {
        activate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      readEntryFile: async () => 'async function setup() {}',
    });
    coordinatorRef.current = coordinator;

    await coordinator.onLibraryOpened({ libraryId: 'library-1', libraryDirectory: '/libraries/one' });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(coordinator.listActiveInstances('library-1')).toEqual([
      expect.objectContaining({ pluginId: 'com.example.setup-callback' }),
    ]);
  });

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
      readEntryFile: async () => 'async function setup() {}',
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'library-1',
      pluginId: 'com.example.trusted',
      entryJavaScript: 'async function setup() {}',
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
      readEntryFile: async () => 'async function setup() {}',
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
      readEntryFile: async () => 'async function setup() {}',
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
      readEntryFile: async () => 'async function setup() {}',
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    expect(contributions.list().map((entry) => entry.id).sort()).toEqual([
      'com.example.contrib.library-1.board',
      'com.example.contrib.library-1.do-thing',
      'com.example.contrib.library-1.menu.asset.do-thing',
    ]);

    // listContributions must match by instanceId (active map is keyed by pluginId).
    const listedMenus = coordinator.listContributions({
      libraryId: 'library-1',
      target: 'menus.asset',
    });
    expect(listedMenus).toEqual([expect.objectContaining({
      kind: 'menu',
      id: 'com.example.contrib.library-1.menu.asset.do-thing',
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
      id: 'com.example.contrib.library-1.board',
      pluginId: 'com.example.contrib',
    })]);

    coordinator.onLibraryClosed('library-1');
    expect(contributions.list()).toEqual([]);
    expect(coordinator.listContributions({ libraryId: 'library-1' })).toEqual([]);
    expect(deactivateLibrary).toHaveBeenCalledWith('library-1', 'library-closed');
  });

  it('allows the same plugin contributions in two open libraries without ID collision', async () => {
    const { createContributionRegistry } = await import('../../src/plugins/plugin-contributions');
    const contributions = createContributionRegistry();
    const activate = vi.fn(async () => undefined);
    const contribPackage = {
      lock: { pluginId: 'com.example.contrib', version: '1.0.0', packageHash: 'f'.repeat(64) },
      manifest: {
        runtime: { mode: 'restricted', entry: 'dist/main.js' },
        permissions: ['library.read', 'asset.read'],
        contributes: {
          commands: [{ id: 'do-thing', title: 'Do thing' }],
          menus: { asset: [{ command: 'do-thing' }] },
          views: [],
          settings: [],
          hooks: [],
          providers: [],
        },
      },
      packageDirectory: '/plugins/contrib',
    };
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async () => [{ status: 'valid', package: contribPackage }],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-global',
          package: contribPackage,
        }),
      } as never,
      supervisor: {
        activate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      contributions,
      readEntryFile: async () => 'async function activate() {}',
    });

    await coordinator.onLibraryOpened({
      libraryId: 'library-1',
      libraryDirectory: '/libraries/one',
    });
    await coordinator.onLibraryOpened({
      libraryId: 'library-2',
      libraryDirectory: '/libraries/two',
    });

    expect(activate).toHaveBeenCalledTimes(2);
    expect(coordinator.listContributions({
      libraryId: 'library-1',
      target: 'menus.asset',
    })).toEqual([expect.objectContaining({
      id: 'com.example.contrib.library-1.menu.asset.do-thing',
      pluginId: 'com.example.contrib',
    })]);
    expect(coordinator.listContributions({
      libraryId: 'library-2',
      target: 'menus.asset',
    })).toEqual([expect.objectContaining({
      id: 'com.example.contrib.library-2.menu.asset.do-thing',
      pluginId: 'com.example.contrib',
    })]);
    expect(contributions.list()).toHaveLength(4);

    coordinator.onLibraryClosed('library-1');
    expect(coordinator.listContributions({
      libraryId: 'library-2',
      target: 'menus.asset',
    })).toEqual([expect.objectContaining({
      id: 'com.example.contrib.library-2.menu.asset.do-thing',
    })]);
    expect(coordinator.listContributions({ libraryId: 'library-1' })).toEqual([]);
  });

  it('activates one global instance for multiple libraries and keeps it after a library closes', async () => {
    const { createContributionRegistry } = await import('../../src/plugins/plugin-contributions');
    const { createPluginProviderRegistry } = await import('../../src/plugins/plugin-providers');
    const contributions = createContributionRegistry();
    const providers = createPluginProviderRegistry();
    const activate = vi.fn(async () => undefined);
    const deactivate = vi.fn();
    const globalPackage = {
      lock: { pluginId: 'com.example.global', version: '1.0.0', packageHash: 'a'.repeat(64) },
      manifest: {
        runtime: { mode: 'restricted', entry: 'dist/main.js', instanceScope: 'global' },
        permissions: ['library.read'],
        contributes: {
          commands: [{ id: 'global-command', title: 'Global command' }],
          menus: {},
          settings: [],
          toolbar: [],
          inspector: [],
          viewerActions: [],
          shortcuts: [],
          views: [],
          hooks: [],
          jobs: [],
          providers: [{ id: 'global-provider', kind: 'search' }],
          themes: [],
        },
      },
      packageDirectory: '/plugins/global',
      scope: 'user',
    };
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async ({ scope }: { scope: string }) => scope === 'user'
          ? [{ status: 'valid', package: globalPackage }]
          : [],
        listGlobalActivationCandidates: async () => [globalPackage],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-global',
          package: globalPackage,
        }),
      } as never,
      supervisor: {
        activate,
        deactivate,
        deactivateLibrary: vi.fn(),
        deliverDomainEvent: vi.fn(),
      } as never,
      contributions,
      providers,
      readEntryFile: async () => 'async function setup() {}',
      globalRuntimeContext: {
        libraryId: '__test_global_runtime__',
        libraryDirectory: '/user-data',
      },
    });

    await coordinator.refreshGlobal();
    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith(expect.objectContaining({
      instanceScope: 'global',
      installScope: 'user',
      libraryId: '__test_global_runtime__',
    }));
    const firstActivation = activate.mock.calls[0] as unknown as [{ instanceId: string }] | undefined;
    if (firstActivation === undefined) throw new Error('Expected the global instance to activate.');
    const globalInstanceId = firstActivation[0].instanceId;
    expect(globalInstanceId).toEqual(expect.any(String));

    await coordinator.onLibraryOpened({ libraryId: 'library-1', libraryDirectory: '/libraries/one' });
    await coordinator.onLibraryOpened({ libraryId: 'library-2', libraryDirectory: '/libraries/two' });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(contributions.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pluginInstanceId: globalInstanceId,
        libraryId: globalInstanceId,
      }),
    ]));
    expect(contributions.list().some((entry) => entry.libraryId === 'library-1')).toBe(false);
    expect(contributions.list().some((entry) => entry.libraryId === 'library-2')).toBe(false);
    expect(coordinator.listActiveInstances('library-2')).toEqual([expect.objectContaining({
      instanceScope: 'global',
      pluginId: 'com.example.global',
    })]);
    expect(coordinator.listActiveProviders('library-2')).toEqual([
      expect.objectContaining({ pluginInstanceId: expect.any(String), pluginId: 'com.example.global' }),
    ]);

    coordinator.onLibraryClosed('library-1');
    expect(deactivate).not.toHaveBeenCalled();
    expect(coordinator.listContributions({ libraryId: 'library-2', target: 'commands' })).toHaveLength(1);

    coordinator.dispose();
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(contributions.list()).toEqual([]);
    expect(providers.list()).toEqual([]);
  });

  it('evicts contributions and active state when a global Host crashes', async () => {
    const { createContributionRegistry } = await import('../../src/plugins/plugin-contributions');
    const contributions = createContributionRegistry();
    const activate = vi.fn(async () => undefined);
    const pausePluginJobs = vi.fn(async () => undefined);
    const globalPackage = {
      lock: { pluginId: 'com.example.crash-global', version: '1.0.0', packageHash: 'c'.repeat(64) },
      manifest: {
        runtime: { mode: 'restricted', entry: 'dist/main.js', instanceScope: 'global' },
        permissions: ['library.read'],
        contributes: {
          commands: [{ id: 'command', title: 'Command' }],
          menus: {},
          settings: [],
          toolbar: [],
          inspector: [],
          viewerActions: [],
          shortcuts: [],
          views: [],
          hooks: [],
          jobs: [],
          providers: [],
          themes: [],
        },
      },
      packageDirectory: '/plugins/crash-global',
      scope: 'user',
    };
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listGlobalActivationCandidates: async () => [globalPackage],
        listInstalled: async ({ scope }: { scope: string }) => scope === 'user'
          ? [{ status: 'valid', package: globalPackage }]
          : [],
        resolve: async () => ({ status: 'resolved', selection: 'use-global', package: globalPackage }),
      } as never,
      supervisor: {
        activate,
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
      } as never,
      contributions,
      readEntryFile: async () => 'async function setup() {}',
      pausePluginJobs,
    });

    await coordinator.refreshGlobal();
    const firstActivation = activate.mock.calls[0] as unknown as [{ instanceId: string }] | undefined;
    const instanceId = firstActivation?.[0].instanceId;
    expect(instanceId).toEqual(expect.any(String));
    await coordinator.onLibraryOpened({ libraryId: 'library-1', libraryDirectory: '/libraries/one' });
    await coordinator.onLibraryOpened({ libraryId: 'library-2', libraryDirectory: '/libraries/two' });
    expect(coordinator.listActiveInstances('library-1')).toHaveLength(1);
    expect(contributions.list()).toHaveLength(1);

    coordinator.onInstanceCrashed({ instanceId: instanceId!, failureCode: 'RUNTIME_PROCESS_EXITED' });
    await Promise.resolve();

    expect(coordinator.listActiveInstances('library-1')).toEqual([]);
    expect(contributions.list()).toEqual([]);
    expect(pausePluginJobs).toHaveBeenCalledTimes(2);
    expect(pausePluginJobs).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'library-1',
      owners: [{ pluginId: 'com.example.crash-global', packageHash: 'c'.repeat(64) }],
    }));
    expect(pausePluginJobs).toHaveBeenCalledWith(expect.objectContaining({
      libraryId: 'library-2',
      owners: [{ pluginId: 'com.example.crash-global', packageHash: 'c'.repeat(64) }],
    }));
  });

  it('freezes the actual target library on a global command invocation', async () => {
    const { createContributionRegistry } = await import('../../src/plugins/plugin-contributions');
    const contributions = createContributionRegistry();
    const invokeCommand = vi.fn(async (input: { context: Record<string, unknown> }) => ({
      complete: { invokeId: 'invoke-1', status: 'succeeded' as const },
      timedOut: false,
      observedContext: input.context,
    }));
    const globalPackage = {
      scope: 'user' as const,
      lock: { pluginId: 'com.example.global-command', version: '1.0.0', packageHash: 'd'.repeat(64) },
      manifest: {
        runtime: { mode: 'restricted' as const, entry: 'dist/main.js', instanceScope: 'global' as const },
        permissions: ['library.read' as const],
        contributes: {
          commands: [{ id: 'inspect-target', title: 'Inspect target' }],
          menus: {}, toolbar: [], inspector: [], viewerActions: [], shortcuts: [], views: [],
          settings: [], hooks: [], jobs: [], providers: [], themes: [],
        },
      },
      packageDirectory: '/plugins/global-command',
    };
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listGlobalActivationCandidates: async () => [globalPackage],
        listInstalled: async ({ scope }: { scope: string }) => scope === 'user'
          ? [{ status: 'valid', package: globalPackage }]
          : [],
        resolve: async () => ({
          status: 'resolved',
          selection: 'use-global',
          package: globalPackage,
        }),
      } as never,
      supervisor: {
        activate: vi.fn(async () => undefined),
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
        invokeCommand,
      } as never,
      contributions,
      readEntryFile: async () => 'async function setup() {}',
    });

    await coordinator.onLibraryOpened({ libraryId: 'library-1', libraryDirectory: '/libraries/one' });
    await coordinator.onLibraryOpened({ libraryId: 'library-2', libraryDirectory: '/libraries/two' });
    const command = coordinator.listContributions({ libraryId: 'library-2', target: 'commands' })[0];
    expect(command).toBeDefined();
    const result = await coordinator.runCommand({
      libraryId: 'library-2',
      contributionId: command!.id,
    });

    expect(result.complete.status).toBe('succeeded');
    expect(invokeCommand).toHaveBeenCalledWith(expect.objectContaining({
      context: { targetLibraryId: 'library-2' },
    }));
    const context = invokeCommand.mock.calls[0]?.[0].context;
    expect(Object.isFrozen(context)).toBe(true);
  });

  it('rejects a library-scoped contribution when invoked against another library', async () => {
    const { createContributionRegistry } = await import('../../src/plugins/plugin-contributions');
    const contributions = createContributionRegistry();
    const libraryPackage = {
      scope: 'library' as const,
      lock: { pluginId: 'com.example.library-command', version: '1.0.0', packageHash: 'e'.repeat(64) },
      manifest: {
        runtime: { mode: 'restricted' as const, entry: 'dist/main.js' },
        permissions: ['library.read' as const],
        contributes: {
          commands: [{ id: 'library-only', title: 'Library only' }],
          menus: {}, toolbar: [], inspector: [], viewerActions: [], shortcuts: [], views: [],
          settings: [], hooks: [], jobs: [], providers: [], themes: [],
        },
      },
      packageDirectory: '/plugins/library-command',
    };
    const coordinator = new PluginActivationCoordinator({
      packageManager: {
        getSafeMode: async () => false,
        listInstalled: async ({ scope }: { scope: string }) => scope === 'library'
          ? [{ status: 'valid', package: libraryPackage }]
          : [],
        resolve: async ({ libraryId }: { libraryId: string }) => ({
          status: 'resolved',
          selection: 'use-library',
          package: { ...libraryPackage, lock: { ...libraryPackage.lock } },
          libraryId,
        }),
      } as never,
      supervisor: {
        activate: vi.fn(async () => undefined),
        deactivate: vi.fn(),
        deactivateLibrary: vi.fn(),
        invokeCommand: vi.fn(async () => ({
          complete: { invokeId: 'invoke-2', status: 'succeeded' as const },
          timedOut: false,
        })),
      } as never,
      contributions,
      readEntryFile: async () => 'async function setup() {}',
    });

    await coordinator.onLibraryOpened({ libraryId: 'library-1', libraryDirectory: '/libraries/one' });
    const command = coordinator.listContributions({ libraryId: 'library-1', target: 'commands' })[0];
    expect(command).toBeDefined();
    await coordinator.onLibraryOpened({ libraryId: 'library-2', libraryDirectory: '/libraries/two' });

    await expect(coordinator.runCommand({
      libraryId: 'library-2',
      contributionId: command!.id,
    })).rejects.toThrow('The plugin command contribution is not active.');
  });
});
