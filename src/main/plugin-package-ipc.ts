import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type PluginManagerPackageSummary,
  type PluginManagerResolutionCandidate,
  type PluginManagerResolutionSummary,
  type PluginManagerResponse,
  type PluginManagerSourceSummary,
  type PluginManagerRequest,
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
  /** Main-owned native picker. It must never return a value to Renderer. */
  chooseLocalPackage(): Promise<string | undefined>;
  /**
   * Called after a successful mutation that can change which packages should
   * be active. Main uses this to refresh the Standard Plugin Host without
   * requiring a full library reopen.
   */
  afterMutation?: (context: {
    requestType: PluginManagerRequest['type'];
    libraryId?: string;
    libraryDirectory?: string;
  }) => Promise<void>;
  logger?: { error(scope: string, error: unknown, context?: Record<string, unknown>): void };
}

function sourceSummary(source: InstalledPluginPackage['lock']['source']): PluginManagerSourceSummary {
  if (source.kind === 'github') {
    return {
      kind: source.kind,
      repository: source.repository,
      ref: source.ref,
      commitSha: source.commitSha,
    };
  }
  return { kind: source.kind };
}

function packageTrust(entry: PluginInstalledPackageStatus): 'trusted' | 'denied' | 'untrusted' {
  if (entry.status === 'invalid') return 'untrusted';
  // User-scope code is installed by the local user and does not undergo the
  // cross-device library trust gate. Library packages still require a device
  // decision before resolution can activate them.
  if (entry.package.scope === 'user') return 'trusted';
  return entry.trust?.decision ?? 'untrusted';
}

function summary(entry: PluginInstalledPackageStatus): PluginManagerPackageSummary {
  if (entry.status === 'invalid') {
    return {
      pluginId: entry.package.pluginId,
      version: entry.package.version,
      name: entry.package.pluginId,
      description: 'Package verification failed.',
      packageHash: entry.package.packageHash,
      runtimeMode: 'standard',
      permissions: [],
      source: sourceSummary(entry.package.source),
      scope: entry.scope,
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
    packageHash: entry.package.lock.packageHash,
    runtimeMode: entry.package.manifest.runtime.mode,
    permissions: [...entry.package.manifest.permissions],
    source: sourceSummary(entry.package.lock.source),
    scope: entry.package.scope,
    status: 'valid',
    trust: packageTrust(entry),
  };
}

function candidateSummary(
  pluginPackage: InstalledPluginPackage,
  trust: 'trusted' | 'denied' | 'untrusted',
): PluginManagerResolutionCandidate {
  return {
    scope: pluginPackage.scope,
    version: pluginPackage.lock.version,
    packageHash: pluginPackage.lock.packageHash,
    runtimeMode: pluginPackage.manifest.runtime.mode,
    permissions: [...pluginPackage.manifest.permissions],
    source: sourceSummary(pluginPackage.lock.source),
    trust,
  };
}

function trustForPackage(
  pluginPackage: InstalledPluginPackage,
  packageSummaries: readonly PluginManagerPackageSummary[],
): 'trusted' | 'denied' | 'untrusted' {
  return packageSummaries.find((entry) => entry.packageHash === pluginPackage.lock.packageHash
    && entry.scope === pluginPackage.scope)?.trust
    ?? (pluginPackage.scope === 'user' ? 'trusted' : 'untrusted');
}

function resolutionSummary(
  result: Awaited<ReturnType<PluginPackageManager['resolve']>>,
  packageSummaries: readonly PluginManagerPackageSummary[],
  requestedPluginId: string,
): PluginManagerResolutionSummary {
  if (result.status === 'not-installed') return { status: 'not-installed', pluginId: requestedPluginId };
  if (result.status === 'disabled') {
    return result.reason === 'quarantined'
      ? {
        status: 'disabled',
        pluginId: requestedPluginId,
        reason: result.reason,
        version: result.package.lock.version,
        packageHash: result.package.lock.packageHash,
      }
      : { status: 'disabled', pluginId: requestedPluginId, reason: result.reason };
  }
  if (result.status === 'conflict') {
    return {
      status: 'conflict',
      pluginId: requestedPluginId,
      candidates: [
        candidateSummary(result.global, trustForPackage(result.global, packageSummaries)),
        candidateSummary(result.library, trustForPackage(result.library, packageSummaries)),
      ],
    };
  }
  if (result.status === 'resolved') {
    return {
      status: 'resolved',
      pluginId: result.package.lock.pluginId,
      version: result.package.lock.version,
      packageHash: result.package.lock.packageHash,
      selection: result.selection,
    };
  }
  if (result.status === 'awaiting-trust') {
    return {
      status: 'awaiting-trust',
      pluginId: result.package.lock.pluginId,
      version: result.package.lock.version,
      packageHash: result.package.lock.packageHash,
      selection: result.selection,
      reason: result.reason,
    };
  }
  return {
    status: 'requires-confirmation',
    pluginId: result.current.lock.pluginId,
    reason: result.reason,
    current: candidateSummary(result.current, trustForPackage(result.current, packageSummaries)),
    ...(result.candidate === undefined ? {} : {
      candidate: candidateSummary(result.candidate, trustForPackage(result.candidate, packageSummaries)),
    }),
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

/** Returns false for a deliberately cancelled native picker. */
async function installLocal(
  request: Extract<PluginManagerRequest, { type: 'plugin-manager.install-local' }>,
  libraryDirectory: string | undefined,
  options: PluginPackageIpcOptions,
): Promise<boolean> {
  const selected = await options.chooseLocalPackage();
  if (selected === undefined) return false;
  const source = {
    kind: 'local-directory' as const,
    // A lock never records the local path. The hash keeps ordinary updates
    // source-stable without disclosing it through a Renderer-facing response.
    fingerprint: `local:${createHash('sha256').update(selected).digest('hex')}`,
  };
  const selectedStats = await stat(selected);
  if (selectedStats.isDirectory()) {
    await options.manager.installFromDirectory({
      directory: selected,
      scope: request.scope,
      libraryDirectory,
      source,
    });
    return true;
  }
  if (path.extname(selected).toLowerCase() !== '.zip') {
    throw new PluginPackageManagerError('PLUGIN_ARCHIVE_INVALID', 'Select a plugin directory or ZIP package.');
  }
  await options.manager.installFromArchive({
    archive: await readFile(selected),
    scope: request.scope,
    libraryDirectory,
    source: { kind: 'local-package', fingerprint: source.fingerprint },
  });
  return true;
}

function libraryIdFor(request: PluginManagerRequest): string | undefined {
  return request.type === 'plugin-manager.resolve'
    ? request.libraryId
    : 'libraryId' in request ? request.libraryId : undefined;
}

export function createPluginPackageRequestHandler(options: PluginPackageIpcOptions) {
  return async (input: unknown): Promise<PluginManagerResponse> => {
    const parsed = pluginManagerRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, code: 'invalid-request' };
    const request = parsed.data;
    try {
      const libraryId = libraryIdFor(request);
      const requiresLibrary = (request.type === 'plugin-manager.resolve'
        || request.type === 'plugin-manager.rollback'
        || request.type === 'plugin-manager.clear-quarantine')
        || ('scope' in request && request.scope === 'library')
        || (request.type === 'plugin-manager.list' && libraryId !== undefined);
      const libraryDirectory = requiresLibrary
        ? await libraryDirectoryFor(request, options)
        : undefined;
      if (requiresLibrary && libraryDirectory === undefined) return { ok: false, code: 'library-not-open' };

      if (request.type === 'plugin-manager.install-local') {
        if (!await installLocal(request, libraryDirectory, options)) {
          return { ok: false, code: 'selection-cancelled' };
        }
      } else if (request.type === 'plugin-manager.install-github') {
        await options.manager.installFromGitHub({
          repository: request.repository,
          scope: request.scope,
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
        await options.manager.chooseResolution({
          libraryId: request.libraryId,
          pluginId: request.pluginId,
          selection: request.selection,
          ...(request.packageHash === undefined ? {} : { packageHash: request.packageHash }),
        });
      } else if (request.type === 'plugin-manager.safe-mode') {
        await options.manager.setSafeMode(request.enabled);
      } else if (request.type === 'plugin-manager.clear-quarantine') {
        await options.manager.clearRuntimeQuarantine({
          libraryId: request.libraryId,
          pluginId: request.pluginId,
          ...(request.packageHash === undefined ? {} : { packageHash: request.packageHash }),
        });
      } else if (request.type === 'plugin-manager.rollback') {
        await options.manager.rollback({
          libraryId: request.libraryId,
          libraryDirectory: libraryDirectory!,
          pluginId: request.pluginId,
        });
      } else if (request.type === 'plugin-manager.uninstall') {
        await options.manager.uninstall({
          scope: request.scope,
          libraryDirectory,
          libraryId,
          pluginId: request.pluginId,
          version: request.version,
        });
      }

      if (options.afterMutation !== undefined
        && request.type !== 'plugin-manager.list') {
        await options.afterMutation({
          requestType: request.type,
          ...(libraryId === undefined ? {} : { libraryId }),
          ...(libraryDirectory === undefined ? {} : { libraryDirectory }),
        });
      }

      const [user, library] = await Promise.all([
        options.manager.listInstalled({ scope: 'user' }),
        libraryDirectory === undefined
          ? Promise.resolve([])
          : options.manager.listInstalled({ scope: 'library', libraryDirectory }),
      ]);
      const packages = [...user, ...library].map(summary);
      const pluginIds = [...new Set(packages.map((entry) => entry.pluginId))];
      const resolutions = libraryId === undefined || libraryDirectory === undefined
        ? []
        : await Promise.all(pluginIds.map(async (pluginId) => resolutionSummary(await options.manager.resolve({
          libraryId,
          libraryDirectory,
          pluginId,
        }), packages, pluginId)));
      return {
        ok: true,
        packages,
        resolutions,
        safeMode: await options.manager.getSafeMode(),
      };
    } catch (error) {
      options.logger?.error('plugin.ipc', error, { requestType: request.type });
      return { ok: false, code: 'operation-failed' };
    }
  };
}
