import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPluginPackageRequestHandler } from '../../src/main/plugin-package-ipc';
import { PluginPackageManager } from '../../src/main/plugin-package-manager';
import {
  parsePluginManagerResponse,
  pluginManagerRequestSchema,
} from '../../src/shared/plugin-manager-api';
import manifestFixture from '../fixtures/plugin-manifests/palette-tools.serpent-plugin.json';

const roots: string[] = [];

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writePlugin(
  directory: string,
  overrides: Partial<{ version: string; permissions: string[] }> = {},
): void {
  const manifest = {
    ...manifestFixture,
    version: overrides.version ?? manifestFixture.version,
    permissions: overrides.permissions ?? manifestFixture.permissions,
  };
  mkdirSync(path.join(directory, 'dist', 'ui'), { recursive: true });
  writeFileSync(path.join(directory, 'serpent-plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(directory, 'dist', 'main.js'), `export const version = ${JSON.stringify(manifest.version)};\n`);
  writeFileSync(path.join(directory, 'dist', 'ui', 'index.html'), '<main>palette</main>\n');
  writeFileSync(path.join(directory, 'README.md'), '# Palette Tools\n');
  writeFileSync(path.join(directory, 'LICENSE'), 'MIT\n');
}

function createManager(userDataDirectory: string): PluginPackageManager {
  return new PluginPackageManager({
    userDataDirectory,
    deviceId: path.basename(userDataDirectory),
    serpentVersion: '0.2.4',
    pluginApiVersion: 1,
    platform: 'darwin',
    arch: 'arm64',
    nodeAbi: 140,
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Plugin package IPC bridge', () => {
  it('parses contribution listing and command invocation requests', () => {
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'menus.asset',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'menus.asset',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'menus.folder',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'menus.folder',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'menus.collection',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'menus.collection',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'menus.workspace',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'menus.workspace',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'toolbar',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'toolbar',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'inspector.sections',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'inspector.sections',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'viewer.actions',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'viewer.actions',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'shortcuts',
    })).toMatchObject({
      type: 'plugin-manager.list-contributions',
      target: 'shortcuts',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.run-command',
      libraryId: 'library-a',
      pluginId: 'com.example.menu',
      commandId: 'probe.write-selection',
      assetIds: ['asset-1'],
    })).toMatchObject({
      type: 'plugin-manager.run-command',
      pluginId: 'com.example.menu',
      commandId: 'probe.write-selection',
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.run-command',
      libraryId: 'library-a',
      pluginId: 'com.example.menu',
      commandId: 'probe.write-folder',
      folderIds: ['folder-1'],
    })).toMatchObject({
      type: 'plugin-manager.run-command',
      commandId: 'probe.write-folder',
      folderIds: ['folder-1'],
    });
    expect(pluginManagerRequestSchema.parse({
      type: 'plugin-manager.run-command',
      libraryId: 'library-a',
      pluginId: 'com.example.menu',
      commandId: 'probe.write-collection',
      collectionIds: ['collection-1'],
    })).toMatchObject({
      type: 'plugin-manager.run-command',
      commandId: 'probe.write-collection',
      collectionIds: ['collection-1'],
    });
    expect(() => pluginManagerRequestSchema.parse({
      type: 'plugin-manager.run-command',
      libraryId: 'library-a',
      assetIds: ['asset-1'],
    })).toThrow();
  });

  it('routes preview and thumbnail provider broker requests without exposing paths', async () => {
    const userData = temporaryRoot('serpent-plugin-ipc-media-user-');
    const calls: Array<{ kind: string; assetId: string }> = [];
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => userData,
      chooseLocalPackage: async () => undefined,
      mediaProvider: async (input) => {
        calls.push({ kind: input.kind, assetId: input.assetId });
        return {
          status: 'provided',
          assetId: input.assetId,
          kind: input.kind,
          providerId: 'probe-provider',
          media: { mimeType: 'image/png', bytesBase64: 'AAAA' },
        };
      },
    });

    await expect(handler({
      type: 'plugin-manager.thumbnail-provider',
      libraryId: 'library-a',
      assetId: 'asset-1',
      deadlineMs: 100,
    })).resolves.toMatchObject({
      ok: true,
      media: {
        status: 'provided',
        assetId: 'asset-1',
        kind: 'thumbnail',
        media: { mimeType: 'image/png', bytesBase64: 'AAAA' },
      },
    });
    await expect(handler({
      type: 'plugin-manager.preview-provider',
      libraryId: 'library-a',
      assetId: 'asset-2',
    })).resolves.toMatchObject({ ok: true, media: { kind: 'preview' } });
    expect(calls).toEqual([
      { kind: 'thumbnail', assetId: 'asset-1' },
      { kind: 'preview', assetId: 'asset-2' },
    ]);
    expect(JSON.stringify(calls)).not.toContain(userData);
  });

  it('forwards metadata-provider requests through the Main broker seam', async () => {
    const userData = temporaryRoot('serpent-plugin-ipc-metadata-user-');
    const calls: Array<{ assetId: string }> = [];
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => userData,
      chooseLocalPackage: async () => undefined,
      metadataProvider: async (input) => {
        calls.push({ assetId: input.assetId });
        return {
          status: 'provided',
          assetId: input.assetId,
          providerId: 'probe-metadata',
          metadata: {
            probeKind: 'metadata-extractor',
            extensionUpper: 'PROBE',
          },
        };
      },
    });

    await expect(handler({
      type: 'plugin-manager.metadata-provider',
      libraryId: 'library-a',
      assetId: 'asset-1',
      deadlineMs: 100,
    })).resolves.toMatchObject({
      ok: true,
      metadata: {
        status: 'provided',
        assetId: 'asset-1',
        providerId: 'probe-metadata',
        metadata: {
          probeKind: 'metadata-extractor',
          extensionUpper: 'PROBE',
        },
      },
    });
    expect(calls).toEqual([{ assetId: 'asset-1' }]);
    expect(JSON.stringify(calls)).not.toContain(userData);
  });

  it('forwards import/export/ai provider requests through the Main broker seam', async () => {
    const userData = temporaryRoot('serpent-plugin-ipc-broker-user-');
    const importCalls: Array<{ fileName: string }> = [];
    const exportCalls: Array<{ assetId: string }> = [];
    const aiCalls: Array<{ assetId: string }> = [];
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => userData,
      chooseLocalPackage: async () => undefined,
      importProvider: async (input) => {
        importCalls.push({ fileName: input.fileName });
        return {
          status: 'provided',
          providerId: 'probe-import',
          importPlan: { accepted: true, note: 'probe-import-accepted' },
        };
      },
      exportProvider: async (input) => {
        exportCalls.push({ assetId: input.assetId });
        return {
          status: 'provided',
          assetId: input.assetId,
          providerId: 'probe-export',
          exportDescriptor: { fileName: 'out.probe', mimeType: 'application/octet-stream' },
        };
      },
      aiProvider: async (input) => {
        aiCalls.push({ assetId: input.assetId });
        return {
          status: 'provided',
          assetId: input.assetId,
          providerId: 'probe-ai',
          analysis: { description: 'Probe', tags: ['probe'], rating: 4 },
        };
      },
    });

    await expect(handler({
      type: 'plugin-manager.import-provider',
      libraryId: 'library-a',
      fileName: 'sample.probe',
      deadlineMs: 100,
    })).resolves.toMatchObject({
      ok: true,
      import: {
        status: 'provided',
        providerId: 'probe-import',
        importPlan: { accepted: true },
      },
    });
    await expect(handler({
      type: 'plugin-manager.export-provider',
      libraryId: 'library-a',
      assetId: 'asset-1',
    })).resolves.toMatchObject({
      ok: true,
      export: { status: 'provided', assetId: 'asset-1' },
    });
    await expect(handler({
      type: 'plugin-manager.ai-provider',
      libraryId: 'library-a',
      assetId: 'asset-2',
    })).resolves.toMatchObject({
      ok: true,
      ai: { status: 'provided', assetId: 'asset-2', analysis: { tags: ['probe'] } },
    });
    expect(importCalls).toEqual([{ fileName: 'sample.probe' }]);
    expect(exportCalls).toEqual([{ assetId: 'asset-1' }]);
    expect(aiCalls).toEqual([{ assetId: 'asset-2' }]);
    expect(JSON.stringify([...importCalls, ...exportCalls, ...aiCalls])).not.toContain(userData);
  });

  it('rejects malformed Renderer input before selecting a path or touching package storage', async () => {
    const userData = temporaryRoot('serpent-plugin-ipc-user-');
    let selectorCalled = false;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => undefined,
      chooseLocalPackage: async () => {
        selectorCalled = true;
        return undefined;
      },
    });

    await expect(handler({ type: 'plugin-manager.install-github', repository: 'https://example.com/nope' }))
      .resolves.toEqual({ ok: false, code: 'invalid-request' });
    expect(selectorCalled).toBe(false);
  });

  it('keeps a Main-selected local path out of Renderer responses and supports a cancelled picker', async () => {
    const source = temporaryRoot('serpent-plugin-ipc-source-');
    const userData = temporaryRoot('serpent-plugin-ipc-user-');
    writePlugin(source);
    let selected: string | undefined = source;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => undefined,
      chooseLocalPackage: async () => selected,
    });

    const installed = await handler({ type: 'plugin-manager.install-local', scope: 'user' });
    expect(installed.ok).toBe(true);
    expect(JSON.stringify(installed)).not.toContain(source);
    if (installed.ok && 'packages' in installed) {
      expect(installed.packages).toMatchObject([{
        pluginId: 'com.example.palette-tools',
        scope: 'user',
        source: { kind: 'local-directory' },
        trust: 'trusted',
      }]);
    }

    selected = undefined;
    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' }))
      .resolves.toEqual({ ok: false, code: 'selection-cancelled' });
  });

  it('returns both exact conflict candidates, then requires library trust before it resolves', async () => {
    const userSource = temporaryRoot('serpent-plugin-ipc-user-source-');
    const librarySource = temporaryRoot('serpent-plugin-ipc-library-source-');
    const userData = temporaryRoot('serpent-plugin-ipc-user-');
    const library = temporaryRoot('serpent-plugin-ipc-library-');
    writePlugin(userSource, { version: '1.2.0' });
    writePlugin(librarySource, { version: '1.3.0' });
    let selected = userSource;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => selected,
    });

    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' })).resolves.toMatchObject({ ok: true });
    selected = librarySource;
    await expect(handler({
      type: 'plugin-manager.install-local',
      scope: 'library',
      libraryId: 'library-a',
    })).resolves.toMatchObject({ ok: true });

    const listed = await handler({ type: 'plugin-manager.list', libraryId: 'library-a' });
    expect(listed.ok).toBe(true);
    if (!listed.ok || !('packages' in listed)) throw new Error('Expected a package listing.');
    const conflict = listed.resolutions.find((item) => item.status === 'conflict');
    expect(conflict).toMatchObject({
      pluginId: 'com.example.palette-tools',
      candidates: [
        { scope: 'user', version: '1.2.0', trust: 'trusted' },
        { scope: 'library', version: '1.3.0', trust: 'untrusted' },
      ],
    });
    if (conflict?.status !== 'conflict') throw new Error('Expected a conflict resolution.');
    const libraryCandidate = conflict.candidates.find((candidate) => candidate.scope === 'library');
    if (libraryCandidate === undefined) throw new Error('Expected the library candidate.');

    const pending = await handler({
      type: 'plugin-manager.resolve',
      libraryId: 'library-a',
      pluginId: 'com.example.palette-tools',
      selection: 'use-library',
      packageHash: libraryCandidate.packageHash,
    });
    expect(pending).toMatchObject({
      ok: true,
      resolutions: [{ status: 'awaiting-trust', packageHash: libraryCandidate.packageHash }],
    });

    const trusted = await handler({
      type: 'plugin-manager.trust',
      scope: 'library',
      libraryId: 'library-a',
      pluginId: 'com.example.palette-tools',
      packageHash: libraryCandidate.packageHash,
      decision: 'trusted',
    });
    expect(trusted).toMatchObject({
      ok: true,
      resolutions: [{
        status: 'resolved',
        selection: 'use-library',
        packageHash: libraryCandidate.packageHash,
      }],
    });
  });

  it('notifies Main after trust and safe-mode mutations so the Host can refresh', async () => {
    const source = temporaryRoot('serpent-plugin-ipc-refresh-source-');
    const userData = temporaryRoot('serpent-plugin-ipc-refresh-user-');
    const library = temporaryRoot('serpent-plugin-ipc-refresh-library-');
    writePlugin(source);
    const mutations: Array<{ requestType: string; libraryId?: string }> = [];
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => source,
      afterMutation: async (context) => {
        mutations.push({
          requestType: context.requestType,
          ...(context.libraryId === undefined ? {} : { libraryId: context.libraryId }),
        });
      },
    });

    const installed = await handler({
      type: 'plugin-manager.install-local',
      scope: 'library',
      libraryId: 'library-a',
    });
    expect(installed).toMatchObject({ ok: true });
    if (!installed.ok || !('packages' in installed)) throw new Error('expected install');
    const packageHash = installed.packages[0]?.packageHash;
    expect(packageHash).toBeTypeOf('string');

    await handler({
      type: 'plugin-manager.trust',
      scope: 'library',
      libraryId: 'library-a',
      pluginId: 'com.example.palette-tools',
      packageHash: packageHash!,
      decision: 'trusted',
    });
    await handler({ type: 'plugin-manager.safe-mode', enabled: true });

    expect(mutations).toEqual(expect.arrayContaining([
      { requestType: 'plugin-manager.install-local', libraryId: 'library-a' },
      { requestType: 'plugin-manager.trust', libraryId: 'library-a' },
      { requestType: 'plugin-manager.safe-mode' },
    ]));
    expect(mutations.some((entry) => entry.requestType === 'plugin-manager.list')).toBe(false);
  });

  it('rolls back through the typed bridge and keeps the previous verified package selected', async () => {
    const firstSource = temporaryRoot('serpent-plugin-ipc-rollback-first-');
    const userData = temporaryRoot('serpent-plugin-ipc-rollback-user-');
    const library = temporaryRoot('serpent-plugin-ipc-rollback-library-');
    writePlugin(firstSource, { version: '1.2.0' });
    const selected = firstSource;
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => selected,
    });

    const firstInstall = await handler({ type: 'plugin-manager.install-local', scope: 'user' });
    expect(firstInstall).toMatchObject({ ok: true, packages: [{ version: '1.2.0' }] });
    if (!firstInstall.ok || !('packages' in firstInstall)) throw new Error('Expected the first plugin install to succeed.');
    const firstPackage = firstInstall.packages[0];
    if (firstPackage === undefined) throw new Error('Expected an installed package.');
    await expect(handler({
      type: 'plugin-manager.resolve',
      libraryId: 'library-a',
      pluginId: firstPackage.pluginId,
      selection: 'use-global',
      packageHash: firstPackage.packageHash,
    })).resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved', version: '1.2.0' }] });

    // An in-place edit is the same local source. A different picker location
    // is deliberately a source change and therefore requires confirmation.
    writePlugin(firstSource, { version: '1.3.0' });
    await expect(handler({ type: 'plugin-manager.install-local', scope: 'user' }))
      .resolves.toMatchObject({ ok: true, packages: [{ version: '1.2.0' }, { version: '1.3.0' }] });
    await expect(handler({ type: 'plugin-manager.list', libraryId: 'library-a' }))
      .resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved', version: '1.3.0' }] });
    await expect(handler({
      type: 'plugin-manager.rollback',
      libraryId: 'library-a',
      pluginId: firstPackage.pluginId,
    })).resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved', version: '1.2.0' }] });
  });

  it('exposes a quarantined package safely and lets the management bridge clear only its local quarantine', async () => {
    const source = temporaryRoot('serpent-plugin-ipc-quarantine-source-');
    const userData = temporaryRoot('serpent-plugin-ipc-quarantine-user-');
    const library = temporaryRoot('serpent-plugin-ipc-quarantine-library-');
    writePlugin(source);
    const manager = createManager(userData);
    const installed = await manager.installFromDirectory({
      directory: source,
      scope: 'user',
      source: { kind: 'local-directory', fingerprint: 'source:stable' },
    });
    await manager.chooseResolution({
      libraryId: 'library-a',
      pluginId: installed.package.lock.pluginId,
      selection: 'use-global',
      packageHash: installed.package.lock.packageHash,
    });
    for (const minute of [0, 1, 2]) {
      await manager.recordRuntimeCrash({
        libraryId: 'library-a',
        libraryDirectory: library,
        pluginId: installed.package.lock.pluginId,
        packageHash: installed.package.lock.packageHash,
        failureCode: 'PLUGIN_RUNTIME_CRASH',
        occurredAt: new Date(Date.UTC(2026, 6, 30, 0, minute, 0)),
      });
    }
    const handler = createPluginPackageRequestHandler({
      manager,
      resolveLibraryDirectory: async (libraryId) => libraryId === 'library-a' ? library : undefined,
      chooseLocalPackage: async () => undefined,
    });

    await expect(handler({ type: 'plugin-manager.list', libraryId: 'library-a' })).resolves.toMatchObject({
      ok: true,
      resolutions: [{
        status: 'disabled',
        reason: 'quarantined',
        packageHash: installed.package.lock.packageHash,
      }],
    });
    await expect(handler({
      type: 'plugin-manager.clear-quarantine',
      libraryId: 'library-a',
      pluginId: installed.package.lock.pluginId,
      packageHash: installed.package.lock.packageHash,
    })).resolves.toMatchObject({ ok: true, resolutions: [{ status: 'resolved' }] });
  });

  it('enriches settings.pages with serpent-plugin:// url and survives Preload parse', async () => {
    const userData = temporaryRoot('serpent-plugin-ipc-contrib-user-');
    const instanceId = '59847245-d394-4012-ad75-35f837393a8f';
    const handler = createPluginPackageRequestHandler({
      manager: createManager(userData),
      resolveLibraryDirectory: async () => userData,
      chooseLocalPackage: async () => undefined,
      activationCoordinator: {
        listContributions: ({ libraryId, target }: { libraryId?: string; target?: string }) => {
          expect(libraryId).toBe('library-a');
          expect(target).toBe('settings.pages');
          return [{
            kind: 'view' as const,
            id: 'com.example.probe.settings-page',
            pluginId: 'com.example.probe',
            pluginInstanceId: instanceId,
            title: 'Probe settings',
            target: 'settings.pages' as const,
            entryPath: 'entry/ui/settings.html',
          }];
        },
        listActiveInstances: () => [{
          pluginId: 'com.example.probe',
          instanceId,
          packageHash: 'a'.repeat(64),
        }],
        trackedOpenLibraryIds: () => ['library-a'],
      } as never,
    });

    const raw = await handler({
      type: 'plugin-manager.list-contributions',
      libraryId: 'library-a',
      target: 'settings.pages',
    });
    expect(raw).toMatchObject({
      ok: true,
      contributions: [{
        kind: 'view',
        target: 'settings.pages',
        entryPath: 'entry/ui/settings.html',
        url: expect.stringMatching(
          /^serpent-plugin:\/\/com\.example\.probe\/59847245-d394-4012-ad75-35f837393a8f\/entry\/ui\/settings\.html/u,
        ),
      }],
    });

    const parsed = parsePluginManagerResponse(raw);
    expect(parsed.ok).toBe(true);
    if (!('contributions' in parsed)) throw new Error('expected contributions');
    expect(parsed.contributions).toHaveLength(1);
    expect(parsed.contributions[0]).toMatchObject({
      kind: 'view',
      target: 'settings.pages',
      url: expect.stringMatching(/^serpent-plugin:\/\//u),
    });
  });
});
