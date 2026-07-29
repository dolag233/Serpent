import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type PluginManagerPackageSummary,
  type PluginManagerRequest,
  type PluginManagerResolutionSummary,
  type PluginManagerResponse,
  pluginManagerRequestSchema,
} from '../shared/plugin-manager-api';
import {
  createGitHubPluginClient,
  type InstalledPluginPackage,
  type PluginInstalledPackageStatus,
  PluginPackageManagerError,
} from './plugin-package-manager';
import type { PluginPackageManager } from './plugin-package-manager';

export interface PluginPackageIpcOptions {
  manager: PluginPackageManager;
  resolveLibraryDirectory(libraryId: string): Promise<string | undefined>;
  chooseLocalPackage(): Promise<string | undefined>;
  logger?: { error(scope: string, error: unknown, context?: Record<string, unknown>): void };
}

function summary(entry: PluginInstalledPackageStatus): PluginManagerPackageSummary {
  if (entry.status === 'invalid') {
    return {
      pluginId: entry.package.pluginId,
      version: entry.package.version,
      name: entry.package.pluginId,
      description: 'Package verification failed.',
      runtimeMode: 'standard',
      permissions: [],
      sourceFingerprint: entry.package.sourceFingerprint,
      scope: 'user',
      status: 'invalid',
      trust: 'untrusted',
      errorCode: entry.errorCode,
    };
  }
  return {
    pluginId: entry.package.lock.pluginId,
    version: entry.package.lock.version,
    name: entry.package.manifest.name,
    description: entry.package.manifest.description,
    runtimeMode: entry.package.manifest.runtime.mode,
    permissions: [...entry.package.manifest.permissions],
    sourceFingerprint: entry.package.lock.sourceFingerprint,
    scope: entry.package.scope,
    status: 'valid',
    trust: entry.trust?.decision ?? 'untrusted',
  };
}

function resolutionSummary(
  result: Awaited<ReturnType<PluginPackageManager['resolve']>>,
): PluginManagerResolutionSummary {
  if (result.status === 'not-installed') return { status: 'not-installed' };
  if (result.status === 'disabled') return { status: 'disabled' };
  if (result.status === 'conflict') return { status: 'conflict' };
  if (result.status === 'resolved' || result.status === 'awaiting-trust') {
    return {
      status: result.status,
      pluginId: result.package.lock.pluginId,
      version: result.package.lock.version,
      selection: result.selection,
      ...(result.status === 'awaiting-trust' ? { reason: result.reason } : {}),
    };
  }
  return {
    status: 'requires-confirmation',
    pluginId: result.current.lock.pluginId,
    version: result.current.lock.version,
    reason: result.reason,
  };
}

async function libraryDirectoryFor(
  request: { scope?: 'user' | 'library'; libraryId?: string },
  options: PluginPackageIpcOptions,
): Promise<string | undefined> {
  if (request.scope === 'user') return undefined;
  if (request.libraryId === undefined) return undefined;
  return options.resolveLibraryDirectory(request.libraryId);
}

async function packageForTrust(
  pluginId: string,
  packageHash: string,
  scope: 'user' | 'library',
  libraryDirectory: string | undefined,
  options: PluginPackageIpcOptions,
): Promise<InstalledPluginPackage | undefined> {
  const packages = await options.manager.listInstalled({ scope, libraryDirectory });
  const match = packages.find((entry) => entry.status === 'valid'
    && entry.package.lock.pluginId === pluginId
    && entry.package.lock.packageHash === packageHash);
  return match?.status === 'valid' ? match.package : undefined;
}

async function installLocal(
  request: Extract<PluginManagerRequest, { type: 'plugin-manager.install-local' }>,
  libraryDirectory: string | undefined,
  options: PluginPackageIpcOptions,
): Promise<void> {
  const selected = await options.chooseLocalPackage();
  if (selected === undefined) throw new PluginPackageManagerError('PLUGIN_SOURCE_READ_FAILED', 'selection-cancelled');
  const source = {
    kind: 'local-directory' as const,
    fingerprint: `local:${createHash('sha256').update(selected).digest('hex')}`,
  };
  const selectedStats = await stat(selected);
  if (selectedStats.isDirectory()) {
    await options.manager.installFromDirectory({ ...request, directory: selected, libraryDirectory, source });
    return;
  }
  if (path.extname(selected).toLowerCase() !== '.zip') {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Select a plugin directory or ZIP package.');
  }
  await options.manager.installFromArchive({
    ...request,
    archive: await readFile(selected),
    libraryDirectory,
    source: { kind: 'local-package', fingerprint: source.fingerprint },
  });
}

export function createPluginPackageRequestHandler(options: PluginPackageIpcOptions) {
  return async (input: unknown): Promise<PluginManagerResponse> => {
    const parsed = pluginManagerRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalid-request' };
    const request = parsed.data;
    try {
      const requiresLibrary = ('scope' in request && request.scope === 'library')
        || ('libraryId' in request && request.libraryId !== undefined && request.type === 'plugin-manager.list');
      const libraryDirectory = requiresLibrary
        ? await libraryDirectoryFor(request, options)
        : undefined;
      if (requiresLibrary && libraryDirectory === undefined) return { ok: false, code: 'library-not-open' };

      if (request.type === 'plugin-manager.install-local') {
        await installLocal(request, libraryDirectory, options);
      } else if (request.type === 'plugin-manager.install-github') {
        await options.manager.installFromGitHub({
          ...request,
          libraryDirectory,
          client: createGitHubPluginClient(),
        });
      } else if (request.type === 'plugin-manager.trust') {
        const pluginPackage = await packageForTrust(
          request.pluginId,
          request.packageHash,
          request.scope,
          libraryDirectory,
          options,
        );
        if (pluginPackage === undefined) return { ok: false, code: 'operation-failed' };
        await options.manager.recordTrust({ package: pluginPackage, decision: request.decision });
      } else if (request.type === 'plugin-manager.resolve') {
        const resolvedLibraryDirectory = await options.resolveLibraryDirectory(request.libraryId);
        if (resolvedLibraryDirectory === undefined) return { ok: false, code: 'library-not-open' };
        await options.manager.chooseResolution(request);
      } else if (request.type === 'plugin-manager.safe-mode') {
        await options.manager.setSafeMode(request.enabled);
      } else if (request.type === 'plugin-manager.uninstall') {
        await options.manager.uninstall({ ...request, libraryDirectory });
      }

      const user = await options.manager.listInstalled({ scope: 'user' });
      const library = libraryDirectory === undefined
        ? []
        : await options.manager.listInstalled({ scope: 'library', libraryDirectory });
      const pluginIds = [...new Set([...user, ...library].map((entry) => entry.status === 'valid'
        ? entry.package.lock.pluginId
        : entry.package.pluginId))];
      const resolutions = request.type === 'plugin-manager.resolve'
        ? [resolutionSummary(await options.manager.resolve({
          libraryId: request.libraryId,
          libraryDirectory: (await options.resolveLibraryDirectory(request.libraryId))!,
          pluginId: request.pluginId,
        }))]
        : libraryDirectory === undefined || !('libraryId' in request) || request.libraryId === undefined
          ? []
          : await Promise.all(pluginIds.map(async (pluginId) => resolutionSummary(await options.manager.resolve({
            libraryId: request.libraryId!,
            libraryDirectory,
            pluginId,
          }))));
      return {
        ok: true,
        packages: [...user, ...library].map(summary),
        resolutions,
        safeMode: await options.manager.getSafeMode(),
      };
    } catch (error) {
      if (error instanceof PluginPackageManagerError && error.message === 'selection-cancelled') {
        return { ok: false, code: 'selection-cancelled' };
      }
      options.logger?.error('plugin.ipc', error, { requestType: parsed.data.type });
      return { ok: false, code: 'operation-failed' };
    }
  };
}
