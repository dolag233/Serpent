import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  type PluginManagerPackageSummary,
  type PluginManagerPluginSettingSection,
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
import type { PluginActivationCoordinator } from './plugin-activation-coordinator';
import type { PluginManifest } from '../plugins/plugin-manifest';
import {
  PluginSettingsStore,
  PluginSettingsStoreError,
  type PluginSettingValue,
} from './plugin-settings-store';
import type { PluginStorageStore } from './plugin-storage-store';
import type { PluginMcpExposureStore } from './plugin-mcp-exposure-store';
import { createPluginUiUrl } from './plugin-ui-assets';
import type {
  PluginMediaProviderInput,
  PluginMediaProviderResult,
  PluginMetadataProviderInput,
  PluginMetadataProviderResult,
  PluginImportProviderInput,
  PluginImportProviderResult,
  PluginExportProviderInput,
  PluginExportProviderResult,
  PluginAiProviderInput,
  PluginAiProviderResult,
  PluginSearchSchedulerInput,
  PluginSearchSchedulerResult,
} from './plugin-provider-scheduler';

function pluginFailureResponse(error: unknown): Extract<PluginManagerResponse, { ok: false }> {
  if (error instanceof PluginPackageManagerError) {
    return {
      ok: false,
      code: 'operation-failed',
      failureCode: error.code,
      message: error.message,
    };
  }
  if (error instanceof PluginSettingsStoreError) {
    return {
      ok: false,
      code: 'operation-failed',
      failureCode: error.code,
      message: error.message,
    };
  }
  return { ok: false, code: 'operation-failed' };
}

export interface PluginPackageIpcOptions {
  manager: PluginPackageManager;
  activationCoordinator?: PluginActivationCoordinator;
  settingsStore?: PluginSettingsStore;
  storageStore?: PluginStorageStore;
  mcpExposureStore?: PluginMcpExposureStore;
  resolveLibraryDirectory(libraryId: string): Promise<string | undefined>;
  /** Main-owned native picker. It must never return a value to Renderer. */
  chooseLocalPackage(): Promise<string | undefined>;
  /** Reveal an installed package directory in the OS file manager. Path stays in Main. */
  revealPackageDirectory?(absoluteDirectory: string): void;
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
  searchProviders?: (input: PluginSearchSchedulerInput) => Promise<PluginSearchSchedulerResult>;
  mediaProvider?: (input: PluginMediaProviderInput) => Promise<PluginMediaProviderResult>;
  metadataProvider?: (input: PluginMetadataProviderInput) => Promise<PluginMetadataProviderResult>;
  importProvider?: (input: PluginImportProviderInput) => Promise<PluginImportProviderResult>;
  exportProvider?: (input: PluginExportProviderInput) => Promise<PluginExportProviderResult>;
  aiProvider?: (input: PluginAiProviderInput) => Promise<PluginAiProviderResult>;
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
      runtimeMode: 'restricted',
      permissions: [],
      source: sourceSummary(entry.package.source),
      sourceFingerprint: entry.package.sourceFingerprint,
      scope: entry.scope,
      status: 'invalid',
      trust: 'untrusted',
      hasSettingsUi: false,
      errorCode: entry.errorCode,
    };
  }
  const settingsCount = entry.package.manifest.contributes.settings.length
    + entry.package.manifest.contributes.views.filter((view) => view.location === 'settings').length;
  return {
    pluginId: entry.package.lock.pluginId,
    version: entry.package.lock.version,
    name: entry.package.manifest.name,
    description: entry.package.manifest.description,
    packageHash: entry.package.lock.packageHash,
    runtimeMode: entry.package.manifest.runtime.mode,
    permissions: [...entry.package.manifest.permissions],
    source: sourceSummary(entry.package.lock.source),
    sourceFingerprint: entry.package.lock.sourceFingerprint,
    scope: entry.package.scope,
    status: 'valid',
    trust: packageTrust(entry),
    hasSettingsUi: settingsCount > 0,
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
  request: { scope?: unknown; libraryId?: string },
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

async function resolvedManifestForSettings(
  request: {
    pluginId: string;
    scope: 'user' | 'library';
    libraryId?: string;
  },
  libraryDirectory: string | undefined,
  options: PluginPackageIpcOptions,
): Promise<{ manifest: PluginManifest; libraryId: string; libraryDirectory: string } | undefined> {
  if (request.scope === 'library') {
    if (request.libraryId === undefined || libraryDirectory === undefined) return undefined;
    const resolution = await options.manager.resolve({
      libraryId: request.libraryId,
      libraryDirectory,
      pluginId: request.pluginId,
    });
    if (resolution.status === 'resolved' || resolution.status === 'awaiting-trust') {
      return {
        manifest: resolution.package.manifest,
        libraryId: request.libraryId,
        libraryDirectory,
      };
    }
    const installed = await options.manager.listInstalled({ scope: 'library', libraryDirectory });
    const valid = installed
      .filter((entry): entry is PluginInstalledPackageStatus & { status: 'valid' } => entry.status === 'valid')
      .filter((entry) => entry.package.lock.pluginId === request.pluginId)
      .sort((left, right) => right.package.lock.version.localeCompare(left.package.lock.version));
    const newest = valid[0]?.package;
    if (newest === undefined) return undefined;
    return {
      manifest: newest.manifest,
      libraryId: request.libraryId,
      libraryDirectory,
    };
  }
  const installed = await options.manager.listInstalled({ scope: 'user' });
  const valid = installed
    .filter((entry): entry is PluginInstalledPackageStatus & { status: 'valid' } => entry.status === 'valid')
    .filter((entry) => entry.package.lock.pluginId === request.pluginId)
    .sort((left, right) => right.package.lock.version.localeCompare(left.package.lock.version));
  const newest = valid[0]?.package;
  if (newest === undefined) return undefined;
  return {
    manifest: newest.manifest,
    libraryId: 'user-default',
    libraryDirectory: '',
  };
}

function settingsLayerForScope(scope: 'user' | 'library'): 'user-default' | 'library' {
  return scope === 'user' ? 'user-default' : 'library';
}

async function mirrorSettingToPluginStorage(input: {
  options: PluginPackageIpcOptions;
  scope: 'user' | 'library';
  pluginId: string;
  libraryId: string;
  libraryDirectory: string;
  settingId: string;
  value: PluginSettingValue;
}): Promise<void> {
  const storage = input.options.storageStore;
  if (storage === undefined) return;
  const storageScope = input.scope === 'user' ? 'user' as const : 'library' as const;
  if (storageScope === 'library' && input.libraryDirectory === '') return;
  await storage.set({
    scope: storageScope,
    pluginId: input.pluginId,
    libraryId: input.libraryId,
    libraryDirectory: input.libraryDirectory,
    key: `settings.${input.settingId}`,
    value: input.value,
  });
}

async function getPluginSettingsSections(
  request: Extract<PluginManagerRequest, { type: 'plugin-manager.get-plugin-settings' }>,
  libraryDirectory: string | undefined,
  options: PluginPackageIpcOptions,
): Promise<PluginManagerPluginSettingSection[] | undefined> {
  const resolved = await resolvedManifestForSettings(request, libraryDirectory, options);
  const store = options.settingsStore;
  if (resolved === undefined || store === undefined) return undefined;
  const snapshot = await store.getEffective({
    libraryId: resolved.libraryId,
    libraryDirectory: resolved.libraryDirectory,
    manifest: resolved.manifest,
  });
  return resolved.manifest.contributes.settings.map((setting) => ({
    id: setting.id,
    title: setting.title,
    type: setting.type,
    value: snapshot.values[setting.id] ?? null,
  }));
}

async function setPluginSettingValue(
  request: Extract<PluginManagerRequest, { type: 'plugin-manager.set-plugin-setting' }>,
  libraryDirectory: string | undefined,
  options: PluginPackageIpcOptions,
): Promise<boolean> {
  const resolved = await resolvedManifestForSettings(request, libraryDirectory, options);
  const store = options.settingsStore;
  if (resolved === undefined || store === undefined) return false;
  const layer = settingsLayerForScope(request.scope);
  await store.set({
    layer,
    libraryId: resolved.libraryId,
    libraryDirectory: resolved.libraryDirectory,
    manifest: resolved.manifest,
    settingId: request.settingId,
    value: request.value,
  });
  try {
    await mirrorSettingToPluginStorage({
      options,
      scope: request.scope,
      pluginId: request.pluginId,
      libraryId: resolved.libraryId,
      libraryDirectory: resolved.libraryDirectory,
      settingId: request.settingId,
      value: request.value,
    });
  } catch (error) {
    if (error instanceof PluginSettingsStoreError) throw error;
    options.logger?.error('plugin.settings.storage-mirror', error, {
      pluginId: request.pluginId,
      settingId: request.settingId,
    });
  }
  return true;
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
    || request.type === 'plugin-manager.reload'
    ? ('libraryId' in request ? request.libraryId : undefined)
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
        || (request.type === 'plugin-manager.list' && libraryId !== undefined)
        || (request.type === 'plugin-manager.reload' && libraryId !== undefined)
        || request.type === 'plugin-manager.run-command'
        || request.type === 'plugin-manager.search-providers'
        || request.type === 'plugin-manager.preview-provider'
        || request.type === 'plugin-manager.thumbnail-provider'
        || request.type === 'plugin-manager.metadata-provider'
        || request.type === 'plugin-manager.import-provider'
        || request.type === 'plugin-manager.export-provider'
        || request.type === 'plugin-manager.ai-provider'
        || (request.type === 'plugin-manager.get-plugin-settings' && request.scope === 'library')
        || (request.type === 'plugin-manager.set-plugin-setting' && request.scope === 'library')
        || request.type === 'plugin-manager.ui-storage-get'
        || request.type === 'plugin-manager.ui-storage-set';
      const libraryDirectory = requiresLibrary
        ? await libraryDirectoryFor(request, options)
        : undefined;
      if (requiresLibrary && libraryDirectory === undefined) return { ok: false, code: 'library-not-open' };

      if (request.type === 'plugin-manager.ui-storage-get'
        || request.type === 'plugin-manager.ui-storage-set') {
        const storage = options.storageStore;
        const permissions = options.activationCoordinator?.pluginUiStoragePermissions({
          libraryId: request.libraryId,
          pluginId: request.pluginId,
          pluginInstanceId: request.pluginInstanceId,
        });
        if (storage === undefined || permissions === undefined || libraryDirectory === undefined) {
          return { ok: false, code: 'operation-failed' };
        }
        const result = await storage.execute({
          operation: request.type === 'plugin-manager.ui-storage-get' ? 'get' : 'set',
          scope: 'library',
          pluginId: request.pluginId,
          libraryId: request.libraryId,
          libraryDirectory,
          key: request.key,
          ...(request.type === 'plugin-manager.ui-storage-set' ? { value: request.value } : {}),
          permissions,
        });
        if (request.type === 'plugin-manager.ui-storage-get') {
          return { ok: true, value: (result as { value?: unknown }).value ?? null };
        }
        return { ok: true, saved: true };
      }

      if (request.type === 'plugin-manager.list-contributions') {
        const contributions = options.activationCoordinator?.listContributions({
          ...(request.libraryId === undefined ? {} : { libraryId: request.libraryId }),
          ...(request.target === undefined ? {} : { target: request.target }),
        }) ?? [];
        return {
          ok: true,
          contributions: contributions.map((contribution) => {
            if (contribution.kind !== 'view' || contribution.entryPath === undefined || request.libraryId === undefined) {
              return contribution;
            }
            return {
              ...contribution,
              url: createPluginUiUrl({
                pluginId: contribution.pluginId,
                instanceId: contribution.pluginInstanceId,
                contributionId: contribution.id,
                libraryId: request.libraryId,
                entryPath: contribution.entryPath,
              }),
            };
          }),
        };
      }
      if (request.type === 'plugin-manager.list-mcp-exposure') {
        return {
          ok: true,
          mcpExposure: options.mcpExposureStore?.listEnabled() ?? [],
        };
      }
      if (request.type === 'plugin-manager.set-mcp-exposure') {
        const declared = options.activationCoordinator?.listMcpCommandContributions()
          .some((command) => command.pluginId === request.pluginId && command.commandId === request.commandId);
        if (!declared || options.mcpExposureStore === undefined) {
          return { ok: false, code: 'operation-failed' };
        }
        await options.mcpExposureStore.setEnabled({
          pluginId: request.pluginId,
          commandId: request.commandId,
          enabled: request.enabled,
        });
        return { ok: true, saved: true };
      }
      if (request.type === 'plugin-manager.get-plugin-settings') {
        const sections = await getPluginSettingsSections(request, libraryDirectory, options);
        if (sections === undefined) return { ok: false, code: 'operation-failed' };
        return { ok: true, sections };
      }
      if (request.type === 'plugin-manager.set-plugin-setting') {
        const saved = await setPluginSettingValue(request, libraryDirectory, options);
        if (!saved) return { ok: false, code: 'operation-failed' };
        return { ok: true, saved: true };
      }
      if (request.type === 'plugin-manager.run-command') {
        if (options.activationCoordinator === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.activationCoordinator.runCommand({
          libraryId: request.libraryId,
          ...(request.contributionId === undefined ? {} : { contributionId: request.contributionId }),
          ...(request.pluginId === undefined ? {} : { pluginId: request.pluginId }),
          ...(request.commandId === undefined ? {} : { commandId: request.commandId }),
          ...(request.assetIds === undefined ? {} : { assetIds: request.assetIds }),
          ...(request.folderIds === undefined ? {} : { folderIds: request.folderIds }),
          ...(request.collectionIds === undefined ? {} : { collectionIds: request.collectionIds }),
        });
        if (result.complete.status !== 'succeeded') return { ok: false, code: 'operation-failed' };
        return { ok: true, executed: true };
      }
      if (request.type === 'plugin-manager.search-providers') {
        if (options.searchProviders === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.searchProviders({
          libraryId: request.libraryId,
          query: request.query,
          ...(request.filters === undefined ? {} : { filters: request.filters }),
          ...(request.scope === undefined ? {} : { scope: request.scope }),
          ...(request.sort === undefined ? {} : { sort: request.sort }),
          ...(request.scopeMode === undefined ? {} : { scopeMode: request.scopeMode }),
          ...(request.limit === undefined ? {} : { limit: request.limit }),
          ...(request.offset === undefined ? {} : { offset: request.offset }),
          ...(request.deadlineMs === undefined
            ? {}
            : { deadlineAt: Date.now() + request.deadlineMs }),
        });
        return { ok: true, search: result };
      }
      if (request.type === 'plugin-manager.preview-provider'
        || request.type === 'plugin-manager.thumbnail-provider') {
        if (options.mediaProvider === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.mediaProvider({
          libraryId: request.libraryId,
          assetId: request.assetId,
          kind: request.type === 'plugin-manager.preview-provider' ? 'preview' : 'thumbnail',
          ...(request.deadlineMs === undefined ? {} : { deadlineAt: Date.now() + request.deadlineMs }),
        });
        return { ok: true, media: result };
      }
      if (request.type === 'plugin-manager.metadata-provider') {
        if (options.metadataProvider === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.metadataProvider({
          libraryId: request.libraryId,
          assetId: request.assetId,
          ...(request.deadlineMs === undefined ? {} : { deadlineAt: Date.now() + request.deadlineMs }),
        });
        return { ok: true, metadata: result };
      }
      if (request.type === 'plugin-manager.import-provider') {
        if (options.importProvider === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.importProvider({
          libraryId: request.libraryId,
          fileName: request.fileName,
          ...(request.extension === undefined ? {} : { extension: request.extension }),
          ...(request.mimeType === undefined ? {} : { mimeType: request.mimeType }),
          ...(request.sizeBytes === undefined ? {} : { sizeBytes: request.sizeBytes }),
          ...(request.deadlineMs === undefined ? {} : { deadlineAt: Date.now() + request.deadlineMs }),
        });
        return { ok: true, import: result };
      }
      if (request.type === 'plugin-manager.export-provider') {
        if (options.exportProvider === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.exportProvider({
          libraryId: request.libraryId,
          assetId: request.assetId,
          ...(request.deadlineMs === undefined ? {} : { deadlineAt: Date.now() + request.deadlineMs }),
        });
        return { ok: true, export: result };
      }
      if (request.type === 'plugin-manager.ai-provider') {
        if (options.aiProvider === undefined) return { ok: false, code: 'operation-failed' };
        const result = await options.aiProvider({
          libraryId: request.libraryId,
          assetId: request.assetId,
          ...(request.deadlineMs === undefined ? {} : { deadlineAt: Date.now() + request.deadlineMs }),
        });
        return { ok: true, ai: result };
      }

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
      } else if (request.type === 'plugin-manager.update-github') {
        await options.manager.applyGitHubUpdateForLock({
          scope: request.scope,
          libraryDirectory,
          pluginId: request.pluginId,
          packageHash: request.packageHash,
          client: createGitHubPluginClient(),
        });
      } else if (request.type === 'plugin-manager.set-auto-update') {
        await options.manager.setAutoUpdatePreference({
          pluginId: request.pluginId,
          sourceFingerprint: request.sourceFingerprint,
          autoUpdate: request.enabled,
        });
      } else if (request.type === 'plugin-manager.reveal-package') {
        const installed = await options.manager.listInstalled({
          scope: request.scope,
          libraryDirectory,
        });
        const match = installed.find((entry) => entry.status === 'valid'
          && entry.package.lock.pluginId === request.pluginId
          && entry.package.lock.version === request.version);
        if (match === undefined || match.status !== 'valid' || options.revealPackageDirectory === undefined) {
          return { ok: false, code: 'operation-failed' };
        }
        options.revealPackageDirectory(match.package.packageDirectory);
      } else if (request.type === 'plugin-manager.reload') {
        if (options.afterMutation !== undefined) {
          await options.afterMutation({
            requestType: request.type,
            ...(libraryId === undefined ? {} : { libraryId }),
            ...(libraryDirectory === undefined ? {} : { libraryDirectory }),
          });
        }
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
        && request.type !== 'plugin-manager.list'
        && request.type !== 'plugin-manager.reload'
        && request.type !== 'plugin-manager.reveal-package') {
        await options.afterMutation({
          requestType: request.type,
          ...(libraryId === undefined ? {} : { libraryId }),
          ...(libraryDirectory === undefined ? {} : { libraryDirectory }),
        });
      }

      // Settings list also drives update discovery and optional auto-update apply.
      if (request.type === 'plugin-manager.list'
        || request.type === 'plugin-manager.install-github'
        || request.type === 'plugin-manager.update-github'
        || request.type === 'plugin-manager.set-auto-update') {
        const githubClient = createGitHubPluginClient();
        try {
          const appliedUser = await options.manager.applyEligibleGitHubAutoUpdates({
            scope: 'user',
            client: githubClient,
            ...(libraryId === undefined ? {} : { libraryId }),
          });
          const appliedLibrary = libraryDirectory === undefined
            ? []
            : await options.manager.applyEligibleGitHubAutoUpdates({
              scope: 'library',
              libraryDirectory,
              ...(libraryId === undefined ? {} : { libraryId }),
              client: githubClient,
            });
          if (options.afterMutation !== undefined
            && (appliedUser.length > 0 || appliedLibrary.length > 0)) {
            await options.afterMutation({
              requestType: 'plugin-manager.update-github',
              ...(libraryId === undefined ? {} : { libraryId }),
              ...(libraryDirectory === undefined ? {} : { libraryDirectory }),
            });
          }
        } catch (error) {
          options.logger?.error('plugin.auto-update', error, { requestType: request.type });
        }
      }

      const [user, library] = await Promise.all([
        options.manager.listInstalled({ scope: 'user' }),
        libraryDirectory === undefined
          ? Promise.resolve([])
          : options.manager.listInstalled({ scope: 'library', libraryDirectory }),
      ]);
      const githubClient = createGitHubPluginClient();
      const packages = await Promise.all([...user, ...library].map(async (entry) => {
        const base = summary(entry);
        if (entry.status !== 'valid' || entry.package.lock.source.kind !== 'github') {
          return base;
        }
        const autoUpdate = await options.manager.getAutoUpdatePreference({
          pluginId: entry.package.lock.pluginId,
          sourceFingerprint: entry.package.lock.sourceFingerprint,
        });
        let availableUpdate: PluginManagerPackageSummary['availableUpdate'];
        try {
          const found = await options.manager.findGitHubAvailableUpdate({
            package: entry.package,
            client: githubClient,
          });
          if (found !== undefined) {
            availableUpdate = {
              version: found.version,
              tag: found.tag,
              assetName: found.assetName,
            };
          }
        } catch (error) {
          options.logger?.error('plugin.check-update', error, {
            pluginId: entry.package.lock.pluginId,
          });
        }
        return {
          ...base,
          autoUpdate,
          ...(availableUpdate === undefined ? {} : { availableUpdate }),
        };
      }));
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
      if (error instanceof PluginSettingsStoreError) {
        options.logger?.error('plugin.settings', error, { requestType: request.type });
      } else {
        options.logger?.error('plugin.ipc', error, { requestType: request.type });
      }
      return pluginFailureResponse(error);
    }
  };
}
