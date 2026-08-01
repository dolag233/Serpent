import { randomUUID } from 'node:crypto';

import type { AssetSummary } from '../shared/asset-types';
import type {
  FilterClause,
  SearchQuery,
  SearchScope,
  SortDefinition,
} from '../shared/asset-types';
import {
  type PluginProviderBatchResult,
  type PluginProviderAiAnalysis,
  type PluginProviderExportDescriptor,
  type PluginProviderImportPlan,
  type PluginProviderMedia,
  type PluginProviderMetadata,
  type PluginProviderInvoke,
  type PluginProviderRegistration,
} from '../plugins/plugin-providers';
import {
  mergePluginSearchResults,
  type PluginSearchChunk,
  type PluginSearchRequest,
} from '../plugins/plugin-search';
import type { PluginActivationCoordinator } from './plugin-activation-coordinator';
import type { PluginRuntimeSupervisor } from './plugin-runtime-supervisor';
import type { PluginTrustedRuntimeSupervisor } from './plugin-trusted-runtime-supervisor';

type ProviderWorkerRequester = (command:
  | { type: 'asset.list'; libraryId: string; recursive: boolean }
  | {
    type: 'plugin.derived-fields.materialize';
    libraryId: string;
    pluginId: string;
    packageHash: string;
    fieldId: string;
    fieldType: NonNullable<PluginProviderRegistration['fieldType']>;
    values: Array<{ assetId: string; value: string | number | boolean | null }>;
  }
  | {
    type: 'asset.search';
    libraryId: string;
    query: SearchQuery | null;
    filters?: FilterClause[];
    scope?: SearchScope;
    sort?: SortDefinition;
    scopeMode?: boolean;
    limit?: number;
    offset?: number;
  }) => Promise<{
    ok: boolean;
    type?: string;
    assets?: AssetSummary[];
    items?: AssetSummary[];
    total?: number;
    offset?: number;
    snippets?: Array<{ assetId: string; text: string }>;
    writtenCount?: number;
    fieldKey?: string;
  }>;

export interface PluginProviderSchedulerLogger {
  info(scope: string, message: string, context?: Record<string, unknown>): void;
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

export interface PluginMediaProviderInput {
  libraryId: string;
  assetId: string;
  kind: 'preview' | 'thumbnail';
  asset?: Pick<AssetSummary, 'assetId' | 'displayName' | 'relativeFilePath' | 'currentRevisionId'>;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export type PluginMediaProviderResult = {
  status: 'provided' | 'native-fallback';
  assetId: string;
  kind: PluginMediaProviderInput['kind'];
  providerId?: string;
  media?: PluginProviderMedia;
  errorCode?: string;
};

export interface PluginMetadataProviderInput {
  libraryId: string;
  assetId: string;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export type PluginMetadataProviderResult = {
  status: 'provided' | 'native-fallback';
  assetId: string;
  providerId?: string;
  metadata?: PluginProviderMetadata;
  errorCode?: string;
};

export interface PluginImportProviderInput {
  libraryId: string;
  fileName: string;
  extension?: string;
  mimeType?: string;
  sizeBytes?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export type PluginImportProviderResult = {
  status: 'provided' | 'native-fallback';
  providerId?: string;
  importPlan?: PluginProviderImportPlan;
  errorCode?: string;
};

export interface PluginExportProviderInput {
  libraryId: string;
  assetId: string;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export type PluginExportProviderResult = {
  status: 'provided' | 'native-fallback';
  assetId: string;
  providerId?: string;
  exportDescriptor?: PluginProviderExportDescriptor;
  errorCode?: string;
};

export interface PluginAiProviderInput {
  libraryId: string;
  assetId: string;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export type PluginAiProviderResult = {
  status: 'provided' | 'native-fallback';
  assetId: string;
  providerId?: string;
  analysis?: PluginProviderAiAnalysis;
  errorCode?: string;
};

export interface PluginSearchSchedulerInput {
  libraryId: string;
  query: SearchQuery | null;
  filters?: FilterClause[];
  scope?: SearchScope;
  sort?: SortDefinition;
  scopeMode?: boolean;
  limit?: number;
  offset?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export interface PluginSearchSchedulerResult {
  items: AssetSummary[];
  total: number;
  offset: number;
  snippets?: Array<{ assetId: string; text: string }>;
  degradedProviders: string[];
}

/**
 * Main-owned Provider broker. It materializes in bounded batches and sends
 * only typed asset snapshots to the Host; Renderer never evaluates providers.
 */
export class PluginProviderScheduler {
  #inFlight = new Set<string>();

  constructor(private readonly options: {
    coordinator: PluginActivationCoordinator;
    supervisor: PluginRuntimeSupervisor;
    trustedSupervisor?: PluginTrustedRuntimeSupervisor;
    requestWorker: ProviderWorkerRequester;
    batchSize?: number;
    timeoutMs?: number;
    searchTimeoutMs?: number;
    logger?: PluginProviderSchedulerLogger;
  }) {}

  async materializeLibrary(libraryId: string, signal?: AbortSignal): Promise<{
    providers: number;
    batches: number;
    writtenCount: number;
    degradedCount: number;
  }> {
    const assetsResult = await this.options.requestWorker({
      type: 'asset.list',
      libraryId,
      recursive: true,
    });
    if (!assetsResult.ok || assetsResult.type !== 'asset.list' || assetsResult.assets === undefined) {
      throw new Error('The Worker could not list assets for Provider materialization.');
    }

    let providers = 0;
    let batches = 0;
    let writtenCount = 0;
    let degradedCount = 0;
    const batchSize = this.options.batchSize ?? 128;
    for (const registration of this.options.coordinator.listActiveProviders(libraryId)) {
      if (registration.kind !== 'derived-field'
        || registration.fieldId === undefined
        || registration.fieldType === undefined) continue;
      providers += 1;
      const key = `${libraryId}:${registration.pluginInstanceId}:${registration.providerId}`;
      if (this.#inFlight.has(key)) continue;
      this.#inFlight.add(key);
      try {
        for (let offset = 0; offset < assetsResult.assets.length; offset += batchSize) {
          if (signal?.aborted) return { providers, batches, writtenCount, degradedCount };
          const batch = assetsResult.assets.slice(offset, offset + batchSize);
          const result = await this.#invoke(registration, batch, signal);
          batches += 1;
          if (result.status !== 'succeeded') {
            degradedCount += 1;
            continue;
          }
          const values = result.values.filter(
            (entry): entry is Extract<PluginProviderBatchResult['values'][number], { value: unknown }> =>
              'value' in entry,
          );
          const stored = await this.options.requestWorker({
            type: 'plugin.derived-fields.materialize',
            libraryId,
            pluginId: registration.pluginId,
            packageHash: registration.packageHash,
            fieldId: registration.fieldId,
            fieldType: registration.fieldType,
            values: values.map((entry) => ({ assetId: entry.assetId, value: entry.value })),
          });
          if (!stored.ok) {
            degradedCount += 1;
          } else {
            writtenCount += stored.writtenCount ?? 0;
          }
        }
      } finally {
        this.#inFlight.delete(key);
      }
    }
    return { providers, batches, writtenCount, degradedCount };
  }

  /**
   * Resolve one opt-in media provider. The native thumbnail/preview pipeline
   * remains the fallback seam; this broker never sends paths to a plugin or
   * Renderer and only returns bounded inline bytes.
   */
  async resolveMediaProvider(input: PluginMediaProviderInput): Promise<PluginMediaProviderResult> {
    const fallback = (errorCode?: string, providerId?: string): PluginMediaProviderResult => ({
      status: 'native-fallback',
      assetId: input.assetId,
      kind: input.kind,
      ...(providerId === undefined ? {} : { providerId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    if (input.signal?.aborted) return fallback('PLUGIN_PROVIDER_CANCELLED');

    let asset = input.asset;
    if (asset === undefined) {
      const listed = await this.options.requestWorker({
        type: 'asset.list',
        libraryId: input.libraryId,
        recursive: true,
      });
      asset = listed.assets?.find((candidate) => candidate.assetId === input.assetId);
      if (!listed.ok || listed.type !== 'asset.list' || asset === undefined) {
        return fallback('ASSET_NOT_FOUND');
      }
    }
    const extension = extensionOf(asset.displayName);
    const registration = this.options.coordinator
      .listActiveProviders(input.libraryId)
      .filter((candidate) => candidate.kind === input.kind
        && candidate.extensions?.some((declared) => declared.replace(/^\./u, '').toLowerCase() === extension))
      .sort((left, right) => `${left.pluginId}.${left.providerId}`.localeCompare(`${right.pluginId}.${right.providerId}`))[0];
    if (registration === undefined) return fallback();

    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const deadlineAt = Math.min(input.deadlineAt ?? Date.now() + timeoutMs, Date.now() + timeoutMs);
    const invoked = await this.#invoke(registration, [asset], input.signal, { deadlineAt });
    if (invoked.status !== 'succeeded') {
      return fallback(invoked.errorCode ?? 'PLUGIN_PROVIDER_FAILED', registration.providerId);
    }
    const value = invoked.values.find((entry) => entry.assetId === input.assetId);
    if (value === undefined || !('media' in value)) {
      return fallback('PROVIDER_MEDIA_MISSING', registration.providerId);
    }
    return {
      status: 'provided',
      assetId: input.assetId,
      kind: input.kind,
      providerId: registration.providerId,
      media: value.media,
    };
  }

  /**
   * Resolve one opt-in metadata extractor. The native extracted-metadata
   * pipeline remains the fallback seam; this broker never sends paths to a
   * plugin or Renderer and only returns bounded JSON metadata.
   */
  async resolveMetadataProvider(input: PluginMetadataProviderInput): Promise<PluginMetadataProviderResult> {
    const fallback = (errorCode?: string, providerId?: string): PluginMetadataProviderResult => ({
      status: 'native-fallback',
      assetId: input.assetId,
      ...(providerId === undefined ? {} : { providerId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    if (input.signal?.aborted) return fallback('PLUGIN_PROVIDER_CANCELLED');

    const listed = await this.options.requestWorker({
      type: 'asset.list',
      libraryId: input.libraryId,
      recursive: true,
    });
    const asset = listed.assets?.find((candidate) => candidate.assetId === input.assetId);
    if (!listed.ok || listed.type !== 'asset.list' || asset === undefined) {
      return fallback('ASSET_NOT_FOUND');
    }
    const extension = extensionOf(asset.displayName);
    const registration = this.options.coordinator
      .listActiveProviders(input.libraryId)
      .filter((candidate) => candidate.kind === 'metadata'
        && candidate.extensions?.some((declared) => declared.replace(/^\./u, '').toLowerCase() === extension))
      .sort((left, right) => `${left.pluginId}.${left.providerId}`.localeCompare(`${right.pluginId}.${right.providerId}`))[0];
    if (registration === undefined) return fallback();

    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const deadlineAt = Math.min(input.deadlineAt ?? Date.now() + timeoutMs, Date.now() + timeoutMs);
    const invoked = await this.#invoke(registration, [asset], input.signal, { deadlineAt });
    if (invoked.status !== 'succeeded') {
      return fallback(invoked.errorCode ?? 'PLUGIN_PROVIDER_FAILED', registration.providerId);
    }
    const value = invoked.values.find((entry) => entry.assetId === input.assetId);
    if (value === undefined || !('metadata' in value)) {
      return fallback('PROVIDER_METADATA_MISSING', registration.providerId);
    }
    return {
      status: 'provided',
      assetId: input.assetId,
      providerId: registration.providerId,
      metadata: value.metadata,
    };
  }

  /**
   * Resolve one opt-in import provider for a candidate file. The Gateway
   * `file.import` pipeline remains the fallback seam; this broker never sends
   * paths to a plugin or Renderer and only returns a bounded import plan stub.
   */
  async resolveImportProvider(input: PluginImportProviderInput): Promise<PluginImportProviderResult> {
    const fallback = (errorCode?: string, providerId?: string): PluginImportProviderResult => ({
      status: 'native-fallback',
      ...(providerId === undefined ? {} : { providerId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    if (input.signal?.aborted) return fallback('PLUGIN_PROVIDER_CANCELLED');

    const extension = normalizeExtension(input.extension ?? extensionOf(input.fileName));
    const registration = this.options.coordinator
      .listActiveProviders(input.libraryId)
      .filter((candidate) => candidate.kind === 'import'
        && (matchesExtension(candidate.extensions, extension)
          || matchesMimeType(candidate.mimeTypes, input.mimeType)))
      .sort((left, right) => `${left.pluginId}.${left.providerId}`.localeCompare(`${right.pluginId}.${right.providerId}`))[0];
    if (registration === undefined) return fallback();

    const importCandidateId = 'import-candidate';
    const importAsset = {
      assetId: importCandidateId,
      displayName: input.fileName,
      relativeFilePath: input.fileName,
    };
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const deadlineAt = Math.min(input.deadlineAt ?? Date.now() + timeoutMs, Date.now() + timeoutMs);
    const invoked = await this.#invoke(registration, [importAsset as never], input.signal, { deadlineAt });
    if (invoked.status !== 'succeeded') {
      return fallback(invoked.errorCode ?? 'PLUGIN_PROVIDER_FAILED', registration.providerId);
    }
    const value = invoked.values.find((entry) => entry.assetId === importCandidateId);
    if (value === undefined || !('importPlan' in value)) {
      return fallback('PROVIDER_IMPORT_PLAN_MISSING', registration.providerId);
    }
    return {
      status: 'provided',
      providerId: registration.providerId,
      importPlan: value.importPlan,
    };
  }

  /**
   * Resolve one opt-in export provider. The native export pipeline remains the
   * fallback seam; this broker never sends paths to a plugin or Renderer and
   * only returns a bounded export descriptor or inline bytes stub.
   */
  async resolveExportProvider(input: PluginExportProviderInput): Promise<PluginExportProviderResult> {
    const fallback = (errorCode?: string, providerId?: string): PluginExportProviderResult => ({
      status: 'native-fallback',
      assetId: input.assetId,
      ...(providerId === undefined ? {} : { providerId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    if (input.signal?.aborted) return fallback('PLUGIN_PROVIDER_CANCELLED');

    const listed = await this.options.requestWorker({
      type: 'asset.list',
      libraryId: input.libraryId,
      recursive: true,
    });
    const asset = listed.assets?.find((candidate) => candidate.assetId === input.assetId);
    if (!listed.ok || listed.type !== 'asset.list' || asset === undefined) {
      return fallback('ASSET_NOT_FOUND');
    }
    const extension = extensionOf(asset.displayName);
    const registration = this.options.coordinator
      .listActiveProviders(input.libraryId)
      .filter((candidate) => candidate.kind === 'export'
        && matchesExtension(candidate.extensions, extension))
      .sort((left, right) => `${left.pluginId}.${left.providerId}`.localeCompare(`${right.pluginId}.${right.providerId}`))[0];
    if (registration === undefined) return fallback();

    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const deadlineAt = Math.min(input.deadlineAt ?? Date.now() + timeoutMs, Date.now() + timeoutMs);
    const invoked = await this.#invoke(registration, [asset], input.signal, { deadlineAt });
    if (invoked.status !== 'succeeded') {
      return fallback(invoked.errorCode ?? 'PLUGIN_PROVIDER_FAILED', registration.providerId);
    }
    const value = invoked.values.find((entry) => entry.assetId === input.assetId);
    if (value === undefined || !('exportDescriptor' in value)) {
      return fallback('PROVIDER_EXPORT_DESCRIPTOR_MISSING', registration.providerId);
    }
    return {
      status: 'provided',
      assetId: input.assetId,
      providerId: registration.providerId,
      exportDescriptor: value.exportDescriptor,
    };
  }

  /**
   * Resolve one opt-in AI analysis provider. The native AI pipeline remains the
   * fallback seam; this broker never calls external networks and only returns a
   * bounded analysis stub from the plugin host.
   */
  async resolveAiProvider(input: PluginAiProviderInput): Promise<PluginAiProviderResult> {
    const fallback = (errorCode?: string, providerId?: string): PluginAiProviderResult => ({
      status: 'native-fallback',
      assetId: input.assetId,
      ...(providerId === undefined ? {} : { providerId }),
      ...(errorCode === undefined ? {} : { errorCode }),
    });
    if (input.signal?.aborted) return fallback('PLUGIN_PROVIDER_CANCELLED');

    const listed = await this.options.requestWorker({
      type: 'asset.list',
      libraryId: input.libraryId,
      recursive: true,
    });
    const asset = listed.assets?.find((candidate) => candidate.assetId === input.assetId);
    if (!listed.ok || listed.type !== 'asset.list' || asset === undefined) {
      return fallback('ASSET_NOT_FOUND');
    }
    const extension = extensionOf(asset.displayName);
    const registration = this.options.coordinator
      .listActiveProviders(input.libraryId)
      .filter((candidate) => candidate.kind === 'ai'
        && matchesExtension(candidate.extensions, extension))
      .sort((left, right) => `${left.pluginId}.${left.providerId}`.localeCompare(`${right.pluginId}.${right.providerId}`))[0];
    if (registration === undefined) return fallback();

    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const deadlineAt = Math.min(input.deadlineAt ?? Date.now() + timeoutMs, Date.now() + timeoutMs);
    const invoked = await this.#invoke(registration, [asset], input.signal, { deadlineAt });
    if (invoked.status !== 'succeeded') {
      return fallback(invoked.errorCode ?? 'PLUGIN_PROVIDER_FAILED', registration.providerId);
    }
    const value = invoked.values.find((entry) => entry.assetId === input.assetId);
    if (value === undefined || !('analysis' in value)) {
      return fallback('PROVIDER_AI_ANALYSIS_MISSING', registration.providerId);
    }
    return {
      status: 'provided',
      assetId: input.assetId,
      providerId: registration.providerId,
      analysis: value.analysis,
    };
  }

  async searchAssets(input: PluginSearchSchedulerInput): Promise<PluginSearchSchedulerResult> {
    const registrations = this.options.coordinator
      .listActiveProviders(input.libraryId)
      .filter((registration) => registration.kind === 'search');
    const limit = Math.min(input.limit ?? 50, 256);
    const offset = input.offset ?? 0;
    const timeoutMs = this.options.searchTimeoutMs ?? this.options.timeoutMs ?? 500;
    const deadlineAt = Math.min(input.deadlineAt ?? Date.now() + timeoutMs, Date.now() + timeoutMs);
    const nativePromise = this.options.requestWorker({
      type: 'asset.search',
      libraryId: input.libraryId,
      query: input.query,
      ...(input.filters === undefined ? {} : { filters: input.filters }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.scopeMode === undefined ? {} : { scopeMode: input.scopeMode }),
      limit,
      offset,
    });
    const assetsPromise = registrations.length === 0
      ? Promise.resolve({ ok: true, assets: [] as AssetSummary[] })
      : this.options.requestWorker({
        type: 'asset.list',
        libraryId: input.libraryId,
        recursive: true,
      });
    const providerPromises = registrations.map((registration) =>
      this.#searchProvider(registration, input, {
        limit,
        offset,
        deadlineAt,
        signal: input.signal,
      }));
    const [nativeResult, assetsResult, ...providerResults] = await Promise.all([
      nativePromise,
      assetsPromise,
      ...providerPromises,
    ]);
    if (!nativeResult.ok || nativeResult.type !== 'asset.search.result'
      || nativeResult.items === undefined || nativeResult.total === undefined
      || nativeResult.offset === undefined) {
      throw new Error('The Worker could not execute native search.');
    }
    const providerAssets = new Map((assetsResult.assets ?? []).map((asset) => [asset.assetId, asset]));
    const merged = mergePluginSearchResults({
      native: {
        items: nativeResult.items,
        total: nativeResult.total,
        offset: nativeResult.offset,
        snippets: nativeResult.snippets,
      },
      providerChunks: providerResults.flatMap((result) => result.chunks),
      providerAssets,
      limit,
      offset,
    });
    return {
      ...merged,
      degradedProviders: providerResults
        .filter((result) => result.degraded)
        .map((result) => result.providerId),
    };
  }

  async #invoke(
    registration: PluginProviderRegistration,
    assets: Array<Pick<AssetSummary, 'assetId' | 'displayName' | 'relativeFilePath' | 'currentRevisionId'>>,
    signal?: AbortSignal,
    options?: { deadlineAt?: number },
  ): Promise<PluginProviderBatchResult> {
    const active = this.options.coordinator.findActiveInstance(registration.pluginInstanceId);
    if (active === undefined) {
      return {
        invokeId: randomUUID(),
        status: 'cancelled',
        values: [],
        errorCode: 'PLUGIN_PROVIDER_INSTANCE_UNAVAILABLE',
      };
    }
    if (signal?.aborted) {
      return { invokeId: randomUUID(), status: 'cancelled', values: [], errorCode: 'PLUGIN_PROVIDER_CANCELLED' };
    }
    const timeoutMs = this.options.timeoutMs ?? 30_000;
    const deadlineAt = options?.deadlineAt ?? Date.now() + timeoutMs;
    const invoke: PluginProviderInvoke = {
      invokeId: randomUUID(),
      providerId: registration.providerId,
      kind: registration.kind,
      ...(registration.fieldId === undefined ? {} : { fieldId: registration.fieldId }),
      ...(registration.fieldType === undefined ? {} : { fieldType: registration.fieldType }),
      batch: assets.map((asset) => ({
        assetId: asset.assetId,
        name: asset.displayName,
        extension: extensionOf(asset.displayName),
        relativeFilePath: asset.relativeFilePath,
        revisionId: asset.currentRevisionId,
      })),
      deadlineAt,
      maxResults: Math.min(assets.length, 256),
    };
    const invokeTimeoutMs = Math.max(1, deadlineAt - Date.now());
    const invoked = active.mode === 'restricted'
      ? await this.options.supervisor.invokeProvider({
        instanceId: active.instanceId,
        invoke,
        timeoutMs: invokeTimeoutMs,
      })
      : await this.options.trustedSupervisor!.invokeProvider({
        instanceId: active.instanceId,
        invoke,
        timeoutMs: invokeTimeoutMs,
      });
    return invoked.result;
  }

  async #searchProvider(
    registration: PluginProviderRegistration,
    input: PluginSearchSchedulerInput,
    requestOptions: {
      limit: number;
      offset: number;
      deadlineAt: number;
      signal?: AbortSignal;
    },
  ): Promise<{ providerId: string; chunks: PluginSearchChunk['items'][]; degraded: boolean }> {
    const active = this.options.coordinator.findActiveInstance(registration.pluginInstanceId);
    if (active === undefined) {
      return { providerId: registration.providerId, chunks: [], degraded: true };
    }
    const request: PluginSearchRequest = {
      invokeId: randomUUID(),
      providerId: registration.providerId,
      query: input.query,
      ...(input.filters === undefined ? {} : { filters: input.filters }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
      ...(input.scopeMode === undefined ? {} : { scopeMode: input.scopeMode }),
      offset: requestOptions.offset,
      limit: requestOptions.limit,
      deadlineAt: requestOptions.deadlineAt,
      maxResults: requestOptions.limit,
    };
    const chunks: PluginSearchChunk['items'][] = [];
    const invoked = active.mode === 'restricted'
      ? await this.options.supervisor.invokeSearch({
        instanceId: active.instanceId,
        request,
        timeoutMs: Math.max(1, requestOptions.deadlineAt - Date.now()),
        signal: requestOptions.signal,
        onChunk: (chunk) => chunks.push(chunk.items),
      })
      : await this.options.trustedSupervisor!.invokeSearch({
        instanceId: active.instanceId,
        request,
        timeoutMs: Math.max(1, requestOptions.deadlineAt - Date.now()),
        signal: requestOptions.signal,
        onChunk: (chunk) => chunks.push(chunk.items),
      });
    const degraded = invoked.timedOut || invoked.complete.status !== 'succeeded';
    if (degraded) {
      this.options.logger?.info('plugin.search.degraded', 'Search provider degraded; native results remain available.', {
        pluginId: registration.pluginId,
        providerId: registration.providerId,
        status: invoked.complete.status,
        errorCode: invoked.complete.errorCode,
      });
    }
    return { providerId: registration.providerId, chunks, degraded };
  }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

function normalizeExtension(value: string): string {
  return value.replace(/^\./u, '').toLowerCase();
}

function matchesExtension(
  extensions: readonly string[] | undefined,
  extension: string,
): boolean {
  if (extensions === undefined || extension.length === 0) return false;
  return extensions.some((declared) => normalizeExtension(declared) === extension);
}

function matchesMimeType(
  mimeTypes: readonly string[] | undefined,
  mimeType: string | undefined,
): boolean {
  if (mimeTypes === undefined || mimeType === undefined) return false;
  const normalized = mimeType.toLowerCase();
  return mimeTypes.some((declared) => declared.toLowerCase() === normalized);
}
