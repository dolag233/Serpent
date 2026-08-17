import { z } from 'zod';

import {
  filterClauseSchema,
  searchQuerySchema,
  searchScopeSchema,
  sortDefinitionSchema,
  type AssetSummary,
  type FilterClause,
  type SearchQuery,
  type SearchScope,
  type SortDefinition,
} from '../shared/asset-types';
import { pluginLocalIdSchema } from './plugin-manifest';

const requestIdSchema = z.string().uuid();

export const pluginSearchRequestSchema = z.strictObject({
  invokeId: requestIdSchema,
  providerId: pluginLocalIdSchema,
  query: searchQuerySchema,
  filters: z.array(filterClauseSchema).max(16).optional(),
  scope: searchScopeSchema.optional(),
  sort: sortDefinitionSchema.optional(),
  scopeMode: z.boolean().optional(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(256),
  deadlineAt: z.number().int().positive(),
  maxResults: z.number().int().positive().max(256),
});
export type PluginSearchRequest = z.infer<typeof pluginSearchRequestSchema>;

export type PluginSearchHandlerRequest = {
  readonly query: SearchQuery | null;
  readonly filters?: readonly FilterClause[];
  readonly scope?: SearchScope;
  readonly sort?: SortDefinition;
  readonly scopeMode?: boolean;
  readonly offset: number;
  readonly limit: number;
  readonly deadlineAt: number;
  readonly maxResults: number;
};

export const pluginSearchResultSchema = z.strictObject({
  assetId: z.string().min(1).max(255),
  /** Stable provider-owned ordering key. It is never evaluated in Renderer. */
  sortKey: z.string().max(512),
  score: z.number().finite().optional(),
});
export type PluginSearchResult = z.infer<typeof pluginSearchResultSchema>;

export const pluginSearchChunkSchema = z.strictObject({
  invokeId: requestIdSchema,
  items: z.array(pluginSearchResultSchema).max(64),
});
export type PluginSearchChunk = z.infer<typeof pluginSearchChunkSchema>;

export const pluginSearchCompleteSchema = z.strictObject({
  invokeId: requestIdSchema,
  status: z.enum(['succeeded', 'failed', 'cancelled']),
  nextOffset: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).max(128).optional(),
  errorDetail: z.string().max(4_096).optional(),
});
export type PluginSearchComplete = z.infer<typeof pluginSearchCompleteSchema>;

export const pluginSearchCancelSchema = z.strictObject({
  invokeId: requestIdSchema,
  reason: z.enum(['cancelled', 'deadline-exceeded', 'deactivated']),
});
export type PluginSearchCancel = z.infer<typeof pluginSearchCancelSchema>;

export type PluginSearchEvent =
  | { type: 'request'; request: PluginSearchRequest }
  | { type: 'cancel'; cancel: PluginSearchCancel };

export function createPluginSearchEventQueue(options?: {
  maxBuffered?: number;
}): {
  push(value: PluginSearchEvent): void;
  next(): Promise<PluginSearchEvent | null>;
  close(): void;
} {
  const maxBuffered = options?.maxBuffered ?? 32;
  const buffered: PluginSearchEvent[] = [];
  const waiters: Array<(value: PluginSearchEvent | null) => void> = [];
  let closed = false;
  return {
    push(value) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter(value);
        return;
      }
      if (buffered.length >= maxBuffered) buffered.shift();
      buffered.push(value);
    },
    next() {
      if (closed) return Promise.resolve(null);
      const value = buffered.shift();
      if (value !== undefined) return Promise.resolve(value);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close() {
      if (closed) return;
      closed = true;
      buffered.length = 0;
      for (const resolve of waiters.splice(0)) resolve(null);
    },
  };
}

export function mergePluginSearchResults(input: {
  native: {
    items: readonly AssetSummary[];
    total: number;
    offset: number;
    snippets?: readonly { assetId: string; text: string }[];
  };
  providerChunks: readonly (readonly PluginSearchResult[])[];
  providerAssets: ReadonlyMap<string, AssetSummary>;
  limit: number;
  offset: number;
}): {
  items: AssetSummary[];
  total: number;
  offset: number;
  snippets?: { assetId: string; text: string }[];
} {
  const items: AssetSummary[] = [];
  const seen = new Set<string>();
  for (const item of input.native.items) {
    if (seen.has(item.assetId)) continue;
    seen.add(item.assetId);
    items.push(item);
  }

  const providerItems = input.providerChunks
    .flatMap((chunk) => [...chunk])
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const providerAssetIds = new Set<string>();
  for (const result of providerItems) {
    if (seen.has(result.assetId)) continue;
    const asset = input.providerAssets.get(result.assetId);
    if (asset === undefined) continue;
    seen.add(result.assetId);
    providerAssetIds.add(result.assetId);
    items.push(asset);
  }

  const capped = items.slice(0, Math.max(0, input.limit));
  const snippets = input.native.snippets === undefined
    ? undefined
    : input.native.snippets.filter((snippet) => seen.has(snippet.assetId));
  return {
    items: capped,
    total: input.native.total + providerAssetIds.size,
    offset: input.offset,
    ...(snippets === undefined ? {} : { snippets: [...snippets] }),
  };
}
