import { z } from 'zod';

import {
  assetMetadataResultSchema,
  assetSummarySchema,
  collectionSummarySchema,
  extractedMetadataResultSchema,
  filterClauseSchema,
  linkedFolderSummarySchema,
  managedFolderSummarySchema,
  searchQuerySchema,
  searchScopeSchema,
  smartCollectionSummarySchema,
  sortDefinitionSchema,
  tagSummarySchema,
} from '../shared/asset-types';
import type { WorkerCommand, WorkerRequest } from '../shared/protocol/requests';
import {
  aiJobSchema,
  internalLibrarySummarySchema,
  tagOperationSkipSchema,
  mediaJobSchema,
  workerResultSchema,
  type WorkerResult,
} from '../shared/protocol/responses';

/**
 * The Automation API is intentionally versioned independently from the
 * renderer IPC protocol. All transports negotiate this value through the
 * Gateway before a Worker command is dispatched.
 */
export const AUTOMATION_API_VERSION = 1 as const;
export const AUTOMATION_DEFAULT_PAGE_SIZE = 50;
export const AUTOMATION_MAX_PAGE_SIZE = 200;

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

const noInputSchema = z.strictObject({});

const paginationInputFields = {
  limit: z.number().int().positive().max(AUTOMATION_MAX_PAGE_SIZE)
    .default(AUTOMATION_DEFAULT_PAGE_SIZE),
  offset: z.number().int().nonnegative().default(0),
};

type PaginationInput = z.infer<z.ZodObject<typeof paginationInputFields>>;

function paginatedInputSchema<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.strictObject({ ...shape, ...paginationInputFields });
}

function paginatedResultSchema<Item extends z.ZodType>(itemSchema: Item) {
  return z.strictObject({
    items: z.array(itemSchema).max(AUTOMATION_MAX_PAGE_SIZE),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().max(AUTOMATION_MAX_PAGE_SIZE),
    hasMore: z.boolean(),
  });
}

function pageFromCompleteList<Item>(
  items: readonly Item[],
  input: PaginationInput,
): { items: Item[]; total: number; offset: number; limit: number; hasMore: boolean } {
  const page = items.slice(input.offset, input.offset + input.limit);
  return {
    items: page,
    total: items.length,
    offset: input.offset,
    limit: input.limit,
    hasMore: input.offset + page.length < items.length,
  };
}

function pageFromWorkerPage<Item>(
  items: readonly Item[],
  total: number,
  input: PaginationInput,
): { items: Item[]; total: number; offset: number; limit: number; hasMore: boolean } {
  const page = items.slice(0, input.limit);
  return {
    items: page,
    total,
    offset: input.offset,
    limit: input.limit,
    hasMore: input.offset + page.length < total,
  };
}

export const automationSourceSchema = z.enum([
  'desktop-console',
  'script',
  'mcp',
  'test',
]);
export type AutomationSource = z.infer<typeof automationSourceSchema>;

export const automationCapabilitySchema = z.enum([
  'library.read',
  'folder.read',
  'asset.read',
  'metadata.read',
  'tag.read',
  'collection.read',
  'job.read',
  'metadata.write',
  'tag.write',
  'collection.write',
  'ai.enqueue',
  'job.manage',
  'file.import',
  'file.move',
  'file.rename',
  'trash.write',
  'clipboard.write',
]);
export type AutomationCapability = z.infer<typeof automationCapabilitySchema>;

/** Immutable proof produced and approved by Main immediately before a file write. */
export interface AutomationFileOperationPlanProof {
  planHash: string;
  expectedChangeSequence: number;
  assetStates: Array<{ assetId: string; stateToken: string }>;
}

export type AutomationImpact = 'read' | 'metadata-write' | 'file-write' | 'destructive' | 'external-effect';
export type AutomationApprovalPolicy = 'none' | 'execution' | 'plan' | 'forbidden';
export type AutomationAtomicity = 'single-transaction' | 'recoverable-file-operation' | 'best-effort';

export const automationCommandInputSchemas = {
  'library.inspect': noInputSchema,
  'folder.list': paginatedInputSchema({}),
  'linked-folder.list': paginatedInputSchema({}),
  'asset.list': paginatedInputSchema({
    folderId: nonBlankString.optional(),
    recursive: z.boolean().default(false),
  }),
  'asset.metadata.get': z.strictObject({ assetId: nonBlankString }),
  'asset.extracted-metadata.get': z.strictObject({ assetId: nonBlankString }),
  'asset.search': paginatedInputSchema({
    query: searchQuerySchema,
    filters: z.array(filterClauseSchema).max(16).optional(),
    scope: searchScopeSchema.optional(),
    sort: sortDefinitionSchema.optional(),
  }),
  'asset.rating.set': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
    rating: z.number().int().min(0).max(5),
  }),
  'asset.paths.copy': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'asset.trash': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'asset.rename-file': z.strictObject({
    assetId: nonBlankString,
    newBaseName: nonBlankString.max(255),
  }),
  'asset.rename-files': z.strictObject({
    items: z.array(z.strictObject({
      assetId: nonBlankString,
      newBaseName: nonBlankString.max(255),
    })).min(1).max(10_000).refine(
      (items) => new Set(items.map((item) => item.assetId)).size === items.length,
      { message: 'items must not contain duplicate assetIds.' },
    ),
  }),
  'asset.list-trash': paginatedInputSchema({}),
  'asset.restore-if-original-vacant': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'asset.palette.aggregate-recent': z.strictObject({
    days: z.number().int().min(1).max(3_650).default(2),
    limit: z.number().int().min(1).max(24).default(12),
  }),
  'tag.list': paginatedInputSchema({}),
  'collection.list': paginatedInputSchema({}),
  'collection.assets.memberships': paginatedInputSchema({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'smart-collection.list': paginatedInputSchema({}),
  'media.jobs.list': paginatedInputSchema({}),
  'ai.jobs.status': paginatedInputSchema({
    jobIds: z.array(nonBlankString).min(1).max(10_000).optional(),
  }),
} as const;

const libraryListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.list'),
  libraries: z.array(internalLibrarySummarySchema),
});

const folderListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('folder.list'),
  folders: z.array(managedFolderSummarySchema),
});

const linkedFolderListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('linked-folder.list'),
  folders: z.array(linkedFolderSummarySchema),
});

const assetListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.list'),
  assets: z.array(assetSummarySchema),
});

// Asset cards represent an image sequence as one playable asset. Returning
// every frame from a list/search result can turn a one-item page into a
// 100,000-item MCP payload, so frame details stay behind a future asset-detail
// command instead of crossing the Automation list boundary.
const automationImageSequenceSummarySchema = z.strictObject({
  sequenceId: nonBlankString,
  fps: z.number().min(1).max(240),
  frameCount: z.number().int().min(3),
});

const automationAssetSummarySchema = assetSummarySchema.extend({
  sequence: automationImageSequenceSummarySchema.nullable().optional(),
});

function automationAssetSummary(
  asset: z.infer<typeof assetSummarySchema>,
): z.infer<typeof automationAssetSummarySchema> {
  return {
    ...asset,
    ...(asset.sequence === undefined
      ? {}
      : {
        sequence: asset.sequence === null
          ? null
          : {
            sequenceId: asset.sequence.sequenceId,
            fps: asset.sequence.fps,
            frameCount: asset.sequence.frameCount,
          },
      }),
  };
}

const assetMetadataWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.metadata.got'),
  metadata: assetMetadataResultSchema,
});

const assetExtractedMetadataWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.extracted-metadata.got'),
  result: extractedMetadataResultSchema,
});

const assetSearchWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.search.result'),
  items: z.array(assetSummarySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  snippets: z.array(z.strictObject({
    assetId: nonBlankString,
    text: nonBlankString,
  })).optional(),
});

const assetRatingWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.rating.updated'),
  updatedCount: z.number().int().nonnegative(),
  skipped: z.array(tagOperationSkipSchema),
});

const mediaAssetPathsWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('media.asset-paths'),
  assetIds: z.array(nonBlankString).min(1),
  absolutePaths: z.array(nonBlankString).min(1),
});

const assetTrashWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.trashed'),
  trashedCount: z.number().int().nonnegative(),
});

const assetRenameWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.file-renamed'),
  asset: assetSummarySchema,
});

const assetRenameFilesWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.files-renamed'),
  renamedCount: z.number().int().nonnegative(),
  skipped: z.array(z.strictObject({
    assetId: nonBlankString,
    reason: z.enum(['asset_not_found', 'asset_unavailable', 'name_conflict', 'invalid_name']),
  })),
  assets: z.array(assetSummarySchema),
});

const assetListTrashWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.list-trash'),
  assets: z.array(assetSummarySchema),
});

const assetRestoreIfOriginalVacantWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.restored-if-original-vacant'),
  restoredCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  skipped: z.array(z.strictObject({
    assetId: nonBlankString,
    reason: z.enum(['original_folder_missing', 'name_conflict', 'trash_file_missing']),
  })),
  assets: z.array(assetSummarySchema),
});

const recentPaletteWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.palette.aggregated-recent'),
  days: z.number().int().positive(),
  assetCount: z.number().int().nonnegative(),
  paletteAssetCount: z.number().int().nonnegative(),
  colors: z.array(z.strictObject({
    hex: z.string().regex(/^#[0-9A-F]{6}$/u),
    weight: z.number().min(0).max(1),
    assetCount: z.number().int().positive(),
  })),
});

const tagListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('tag.list'),
  tags: z.array(tagSummarySchema),
});

const collectionListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('collection.list'),
  collections: z.array(collectionSummarySchema),
});

const collectionMembershipsWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('collection.assets.memberships'),
  memberships: z.array(z.strictObject({
    assetId: nonBlankString,
    collectionId: nonBlankString,
  })),
});

const smartCollectionListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('smart-collection.list'),
  collections: z.array(smartCollectionSummarySchema),
});

const mediaJobsWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('media.jobs.listed'),
  libraryId: nonBlankString,
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  jobs: z.array(mediaJobSchema),
});

const aiJobsWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('ai.jobs.status'),
  libraryId: nonBlankString,
  jobs: z.array(aiJobSchema),
});

const assetSearchAutomationResultSchema = paginatedResultSchema(automationAssetSummarySchema).extend({
  snippets: z.array(z.strictObject({
    assetId: nonBlankString,
    text: nonBlankString,
  })).max(AUTOMATION_MAX_PAGE_SIZE).optional(),
});

const mediaJobsAutomationResultSchema = paginatedResultSchema(mediaJobSchema).extend({
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export const automationCommandResultSchemas = {
  'library.inspect': internalLibrarySummarySchema,
  'folder.list': paginatedResultSchema(managedFolderSummarySchema),
  'linked-folder.list': paginatedResultSchema(linkedFolderSummarySchema),
  'asset.list': paginatedResultSchema(automationAssetSummarySchema),
  'asset.metadata.get': assetMetadataWorkerResultSchema,
  'asset.extracted-metadata.get': assetExtractedMetadataWorkerResultSchema,
  'asset.search': assetSearchAutomationResultSchema,
  'asset.rating.set': z.strictObject({
    updatedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
  }),
  'asset.paths.copy': z.strictObject({ copiedCount: z.number().int().nonnegative() }),
  'asset.trash': z.strictObject({ trashedCount: z.number().int().nonnegative() }),
  'asset.rename-file': z.strictObject({
    assetId: nonBlankString,
    name: nonBlankString,
  }),
  'asset.rename-files': z.strictObject({
    renamedCount: z.number().int().nonnegative(),
    skipped: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: z.enum(['asset_not_found', 'asset_unavailable', 'name_conflict', 'invalid_name']),
    })),
  }),
  'asset.list-trash': paginatedResultSchema(automationAssetSummarySchema),
  'asset.restore-if-original-vacant': z.strictObject({
    restoredCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    skipped: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: z.enum(['original_folder_missing', 'name_conflict', 'trash_file_missing']),
    })),
  }),
  'asset.palette.aggregate-recent': z.strictObject({
    days: z.number().int().positive(),
    assetCount: z.number().int().nonnegative(),
    paletteAssetCount: z.number().int().nonnegative(),
    colors: z.array(z.strictObject({
      hex: z.string().regex(/^#[0-9A-F]{6}$/u),
      weight: z.number().min(0).max(1),
      assetCount: z.number().int().positive(),
    })),
  }),
  'tag.list': paginatedResultSchema(tagSummarySchema),
  'collection.list': paginatedResultSchema(collectionSummarySchema),
  'collection.assets.memberships': paginatedResultSchema(z.strictObject({
    assetId: nonBlankString,
    collectionId: nonBlankString,
  })),
  'smart-collection.list': paginatedResultSchema(smartCollectionSummarySchema),
  'media.jobs.list': mediaJobsAutomationResultSchema,
  'ai.jobs.status': paginatedResultSchema(aiJobSchema),
} as const;

export type AutomationCommandId = keyof typeof automationCommandInputSchemas;
export type AutomationCommandInput<Id extends AutomationCommandId> = z.infer<
  (typeof automationCommandInputSchemas)[Id]
>;
export type AutomationCommandResult<Id extends AutomationCommandId> = z.infer<
  (typeof automationCommandResultSchemas)[Id]
>;

export interface AutomationMcpMetadata {
  public: boolean;
  toolName: string;
  outputLimit: number;
}

export interface AutomationCommandDescriptor<Id extends AutomationCommandId = AutomationCommandId> {
  commandId: Id;
  apiVersion: typeof AUTOMATION_API_VERSION;
  summary: string;
  deprecated: false;
  inputSchema: (typeof automationCommandInputSchemas)[Id];
  resultSchema: (typeof automationCommandResultSchemas)[Id];
  workerResultSchema: z.ZodType;
  requiredCapabilities: readonly AutomationCapability[];
  allowedSources: readonly AutomationSource[];
  impact: AutomationImpact;
  targetScope: 'library' | 'asset' | 'asset-set' | 'job-set';
  supportsBatch: boolean;
  supportsDryRun: boolean;
  supportsIdempotencyKey: boolean;
  supportsCancellation: boolean;
  supportsDetach: boolean;
  supportsUndo: boolean;
  atomicity: AutomationAtomicity;
  approvalPolicy: AutomationApprovalPolicy;
  mcp: AutomationMcpMetadata;
  toWorkerCommand(
    libraryId: string,
    input: AutomationCommandInput<Id>,
    plan?: AutomationFileOperationPlanProof,
  ): WorkerCommand;
  projectResult(
    result: WorkerResult,
    libraryId: string,
    input: AutomationCommandInput<Id>,
  ): AutomationCommandResult<Id> | undefined;
}

function readDescriptor<Id extends AutomationCommandId>(
  descriptor: Omit<AutomationCommandDescriptor<Id>, 'apiVersion' | 'deprecated' | 'impact' | 'supportsDryRun' | 'supportsIdempotencyKey' | 'supportsCancellation' | 'supportsDetach' | 'supportsUndo' | 'atomicity' | 'approvalPolicy'>,
): AutomationCommandDescriptor<Id> {
  return {
    ...descriptor,
    apiVersion: AUTOMATION_API_VERSION,
    deprecated: false,
    impact: 'read',
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'none',
  };
}

const allReadSources = ['desktop-console', 'script', 'mcp', 'test'] as const;

export const automationCommandRegistry = [
  readDescriptor({
    commandId: 'library.inspect',
    summary: '读取当前执行绑定资源库的摘要。',
    inputSchema: automationCommandInputSchemas['library.inspect'],
    resultSchema: automationCommandResultSchemas['library.inspect'],
    workerResultSchema: libraryListWorkerResultSchema,
    requiredCapabilities: ['library.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_library_inspect', outputLimit: 1 },
    toWorkerCommand: () => ({ type: 'library.list' }),
    projectResult: (result, libraryId) => {
      const parsed = libraryListWorkerResultSchema.safeParse(result);
      return parsed.success
        ? parsed.data.libraries.find((library) => library.libraryId === libraryId)
        : undefined;
    },
  }),
  {
    commandId: 'asset.rating.set',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '批量设置资产评分（0–5）。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.rating.set'],
    resultSchema: automationCommandResultSchemas['asset.rating.set'],
    workerResultSchema: assetRatingWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'metadata.write'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'metadata-write',
    targetScope: 'asset-set',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_asset_rating_set', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.rating.set'>) => ({
      type: 'asset.rating.set',
      libraryId,
      assetIds: input.assetIds,
      rating: input.rating,
    }),
    projectResult: (result) => {
      const parsed = assetRatingWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { updatedCount: parsed.data.updatedCount, skipped: parsed.data.skipped }
        : undefined;
    },
  },
  {
    commandId: 'asset.paths.copy',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '将一组资产的真实文件路径复制到系统剪贴板；路径不会返回给脚本。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.paths.copy'],
    resultSchema: automationCommandResultSchemas['asset.paths.copy'],
    workerResultSchema: mediaAssetPathsWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'clipboard.write'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'external-effect',
    targetScope: 'asset-set',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'best-effort',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_asset_paths_copy', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.paths.copy'>) => ({
      type: 'media.get-asset-paths', libraryId, assetIds: input.assetIds,
    }),
    projectResult: (result) => {
      const parsed = mediaAssetPathsWorkerResultSchema.safeParse(result);
      return parsed.success ? { copiedCount: parsed.data.assetIds.length } : undefined;
    },
  },
  {
    commandId: 'asset.trash',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '将托管资产移入 Serpent 回收站；不会永久删除文件。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.trash'],
    resultSchema: automationCommandResultSchemas['asset.trash'],
    workerResultSchema: assetTrashWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'trash.write'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'file-write',
    targetScope: 'asset-set',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: true,
    atomicity: 'recoverable-file-operation',
    approvalPolicy: 'plan',
    mcp: { public: false, toolName: 'serpent_asset_trash', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.trash'>, plan) => ({
      type: 'asset.trash',
      libraryId,
      assetIds: input.assetIds,
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetTrashWorkerResultSchema.safeParse(result);
      return parsed.success ? { trashedCount: parsed.data.trashedCount } : undefined;
    },
  },
  {
    commandId: 'asset.rename-file',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '重命名一项资产的真实文件，只接受不含扩展名的新文件名。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.rename-file'],
    resultSchema: automationCommandResultSchemas['asset.rename-file'],
    workerResultSchema: assetRenameWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'file.rename'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'file-write',
    targetScope: 'asset',
    supportsBatch: false,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'recoverable-file-operation',
    approvalPolicy: 'plan',
    mcp: { public: false, toolName: 'serpent_asset_rename_file', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.rename-file'>, plan) => ({
      type: 'asset.rename-file', libraryId, assetId: input.assetId, newBaseName: input.newBaseName,
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetRenameWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { assetId: parsed.data.asset.assetId, name: parsed.data.asset.displayName }
        : undefined;
    },
  },
  {
    commandId: 'asset.rename-files',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '以一次确认批量重命名真实文件；每项保留原扩展名并返回跳过原因。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.rename-files'],
    resultSchema: automationCommandResultSchemas['asset.rename-files'],
    workerResultSchema: assetRenameFilesWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'file.rename'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'file-write',
    targetScope: 'asset-set',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'recoverable-file-operation',
    approvalPolicy: 'plan',
    mcp: { public: false, toolName: 'serpent_asset_rename_files', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.rename-files'>, plan) => ({
      type: 'asset.rename-files', libraryId, items: input.items,
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetRenameFilesWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { renamedCount: parsed.data.renamedCount, skipped: parsed.data.skipped }
        : undefined;
    },
  },
  readDescriptor({
    commandId: 'asset.list-trash',
    summary: '列出回收站中的资产。',
    inputSchema: automationCommandInputSchemas['asset.list-trash'],
    resultSchema: automationCommandResultSchemas['asset.list-trash'],
    workerResultSchema: assetListTrashWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: false, toolName: 'serpent_asset_list_trash', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'asset.list-trash', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = assetListTrashWorkerResultSchema.safeParse(result);
      return parsed.success
        ? pageFromCompleteList(parsed.data.assets.map(automationAssetSummary), input)
        : undefined;
    },
  }),
  {
    commandId: 'asset.restore-if-original-vacant',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '仅在原始文件夹仍存在且原文件名未被占用时，从回收站恢复资产。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.restore-if-original-vacant'],
    resultSchema: automationCommandResultSchemas['asset.restore-if-original-vacant'],
    workerResultSchema: assetRestoreIfOriginalVacantWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'trash.write'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'file-write',
    targetScope: 'asset-set',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'recoverable-file-operation',
    approvalPolicy: 'plan',
    mcp: { public: false, toolName: 'serpent_asset_restore_if_original_vacant', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.restore-if-original-vacant'>, plan) => ({
      type: 'asset.restore-if-original-vacant', libraryId, assetIds: input.assetIds,
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetRestoreIfOriginalVacantWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          restoredCount: parsed.data.restoredCount,
          skippedCount: parsed.data.skippedCount,
          skipped: parsed.data.skipped,
        }
        : undefined;
    },
  },
  readDescriptor({
    commandId: 'asset.palette.aggregate-recent',
    summary: '汇总近期新增资产已经提取出的自动色卡，不会触发新的色卡任务。',
    inputSchema: automationCommandInputSchemas['asset.palette.aggregate-recent'],
    resultSchema: automationCommandResultSchemas['asset.palette.aggregate-recent'],
    workerResultSchema: recentPaletteWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'metadata.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: false, toolName: 'serpent_asset_palette_aggregate_recent', outputLimit: 24 },
    toWorkerCommand: (libraryId, input) => ({
      type: 'asset.palette.aggregate-recent', libraryId, days: input.days, limit: input.limit,
    }),
    projectResult: (result) => {
      const parsed = recentPaletteWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          days: parsed.data.days,
          assetCount: parsed.data.assetCount,
          paletteAssetCount: parsed.data.paletteAssetCount,
          colors: parsed.data.colors,
        }
        : undefined;
    },
  }),
  readDescriptor({
    commandId: 'folder.list',
    summary: '列出资源库中的托管文件夹。',
    inputSchema: automationCommandInputSchemas['folder.list'],
    resultSchema: automationCommandResultSchemas['folder.list'],
    workerResultSchema: folderListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_folder_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'folder.list', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = folderListWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.folders, input) : undefined;
    },
  }),
  readDescriptor({
    commandId: 'linked-folder.list',
    summary: '列出资源库中的链接文件夹。',
    inputSchema: automationCommandInputSchemas['linked-folder.list'],
    resultSchema: automationCommandResultSchemas['linked-folder.list'],
    workerResultSchema: linkedFolderListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_linked_folder_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'linked-folder.list', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = linkedFolderListWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.folders, input) : undefined;
    },
  }),
  readDescriptor({
    commandId: 'asset.list',
    summary: '列出指定文件夹或资源库范围内的资产。',
    inputSchema: automationCommandInputSchemas['asset.list'],
    resultSchema: automationCommandResultSchemas['asset.list'],
    workerResultSchema: assetListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: true,
    mcp: { public: true, toolName: 'serpent_asset_list', outputLimit: 200 },
    toWorkerCommand: (libraryId, input) => ({
      type: 'asset.list',
      libraryId,
      recursive: input.recursive,
      ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
    }),
    projectResult: (result, _libraryId, input) => {
      const parsed = assetListWorkerResultSchema.safeParse(result);
      return parsed.success
        ? pageFromCompleteList(parsed.data.assets.map(automationAssetSummary), input)
        : undefined;
    },
  }),
  readDescriptor({
    commandId: 'asset.metadata.get',
    summary: '读取一项资产的用户元数据和标签。',
    inputSchema: automationCommandInputSchemas['asset.metadata.get'],
    resultSchema: automationCommandResultSchemas['asset.metadata.get'],
    workerResultSchema: assetMetadataWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'metadata.read'],
    allowedSources: allReadSources,
    targetScope: 'asset',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_asset_metadata_get', outputLimit: 1 },
    toWorkerCommand: (libraryId, input) => ({ type: 'asset.metadata.get', libraryId, assetId: input.assetId }),
    projectResult: (result) => assetMetadataWorkerResultSchema.safeParse(result).data,
  }),
  readDescriptor({
    commandId: 'asset.extracted-metadata.get',
    summary: '读取一项资产的已提取技术元数据。',
    inputSchema: automationCommandInputSchemas['asset.extracted-metadata.get'],
    resultSchema: automationCommandResultSchemas['asset.extracted-metadata.get'],
    workerResultSchema: assetExtractedMetadataWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'metadata.read'],
    allowedSources: allReadSources,
    targetScope: 'asset',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_asset_extracted_metadata_get', outputLimit: 1 },
    toWorkerCommand: (libraryId, input) => ({ type: 'asset.extracted-metadata.get', libraryId, assetId: input.assetId }),
    projectResult: (result) => assetExtractedMetadataWorkerResultSchema.safeParse(result).data,
  }),
  readDescriptor({
    commandId: 'asset.search',
    summary: '使用与桌面浏览一致的结构化查询搜索资产。',
    inputSchema: automationCommandInputSchemas['asset.search'],
    resultSchema: automationCommandResultSchemas['asset.search'],
    workerResultSchema: assetSearchWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: true,
    mcp: { public: true, toolName: 'serpent_asset_search', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input) => ({
      type: 'asset.search',
      libraryId,
      query: input.query,
      // scopeMode intentionally stays false. It is a desktop browse loading
      // optimization that can return a large, unpaged result set.
      scopeMode: false,
      limit: input.limit,
      offset: input.offset,
      ...(input.filters === undefined ? {} : { filters: input.filters }),
      ...(input.scope === undefined ? {} : { scope: input.scope }),
      ...(input.sort === undefined ? {} : { sort: input.sort }),
    }),
    projectResult: (result, _libraryId, input) => {
      const parsed = assetSearchWorkerResultSchema.safeParse(result);
      if (!parsed.success) return undefined;
      const page = pageFromWorkerPage(
        parsed.data.items.map(automationAssetSummary),
        parsed.data.total,
        input,
      );
      const visibleAssetIds = new Set(page.items.map((asset) => asset.assetId));
      return {
        ...page,
        snippets: parsed.data.snippets?.filter((snippet) => visibleAssetIds.has(snippet.assetId)),
      };
    },
  }),
  readDescriptor({
    commandId: 'tag.list',
    summary: '列出资源库标签及使用次数。',
    inputSchema: automationCommandInputSchemas['tag.list'],
    resultSchema: automationCommandResultSchemas['tag.list'],
    workerResultSchema: tagListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_tag_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'tag.list', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = tagListWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.tags, input) : undefined;
    },
  }),
  readDescriptor({
    commandId: 'collection.list',
    summary: '列出资源库的普通合集。',
    inputSchema: automationCommandInputSchemas['collection.list'],
    resultSchema: automationCommandResultSchemas['collection.list'],
    workerResultSchema: collectionListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_collection_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'collection.list', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = collectionListWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.collections, input) : undefined;
    },
  }),
  readDescriptor({
    commandId: 'collection.assets.memberships',
    summary: '读取一组资产所属的合集关系。',
    inputSchema: automationCommandInputSchemas['collection.assets.memberships'],
    resultSchema: automationCommandResultSchemas['collection.assets.memberships'],
    workerResultSchema: collectionMembershipsWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'collection.read'],
    allowedSources: allReadSources,
    targetScope: 'asset-set',
    supportsBatch: true,
    mcp: { public: true, toolName: 'serpent_collection_asset_memberships', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input) => ({
      type: 'collection.assets.memberships',
      libraryId,
      assetIds: input.assetIds,
    }),
    projectResult: (result, _libraryId, input) => {
      const parsed = collectionMembershipsWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.memberships, input) : undefined;
    },
  }),
  readDescriptor({
    commandId: 'smart-collection.list',
    summary: '列出资源库的智能合集。',
    inputSchema: automationCommandInputSchemas['smart-collection.list'],
    resultSchema: automationCommandResultSchemas['smart-collection.list'],
    workerResultSchema: smartCollectionListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_smart_collection_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'smart-collection.list', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = smartCollectionListWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.collections, input) : undefined;
    },
  }),
  readDescriptor({
    commandId: 'media.jobs.list',
    summary: '读取媒体后台任务状态。',
    inputSchema: automationCommandInputSchemas['media.jobs.list'],
    resultSchema: automationCommandResultSchemas['media.jobs.list'],
    workerResultSchema: mediaJobsWorkerResultSchema,
    requiredCapabilities: ['library.read', 'job.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: true,
    mcp: { public: true, toolName: 'serpent_media_jobs_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'media.list-jobs', libraryId }),
    projectResult: (result, _libraryId, input) => {
      const parsed = mediaJobsWorkerResultSchema.safeParse(result);
      if (!parsed.success) return undefined;
      return {
        ...pageFromCompleteList(parsed.data.jobs, input),
        queued: parsed.data.queued,
        running: parsed.data.running,
        succeeded: parsed.data.succeeded,
        failed: parsed.data.failed,
        paused: parsed.data.paused,
        cancelled: parsed.data.cancelled,
      };
    },
  }),
  readDescriptor({
    commandId: 'ai.jobs.status',
    summary: '读取 AI 分析任务状态。',
    inputSchema: automationCommandInputSchemas['ai.jobs.status'],
    resultSchema: automationCommandResultSchemas['ai.jobs.status'],
    workerResultSchema: aiJobsWorkerResultSchema,
    requiredCapabilities: ['library.read', 'job.read'],
    allowedSources: allReadSources,
    targetScope: 'job-set',
    supportsBatch: true,
    mcp: { public: true, toolName: 'serpent_ai_jobs_status', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input) => ({ type: 'ai.status', libraryId, jobIds: input.jobIds }),
    projectResult: (result, _libraryId, input) => {
      const parsed = aiJobsWorkerResultSchema.safeParse(result);
      return parsed.success ? pageFromCompleteList(parsed.data.jobs, input) : undefined;
    },
  }),
] as const satisfies readonly AutomationCommandDescriptor[];

const descriptorsById = new Map<string, AutomationCommandDescriptor>(
  automationCommandRegistry.map((descriptor) => [descriptor.commandId, descriptor]),
);

if (descriptorsById.size !== automationCommandRegistry.length) {
  throw new Error('Automation command registry contains duplicate command IDs.');
}

export function getAutomationCommandDescriptor(commandId: string): AutomationCommandDescriptor | undefined {
  return descriptorsById.get(commandId);
}

/**
 * A transport-neutral, JSON-safe description for Desktop help and future MCP
 * tool generation. It deliberately contains no worker implementation details.
 */
export function describeAutomationCommands(): {
  apiVersion: typeof AUTOMATION_API_VERSION;
  commands: Array<{
    commandId: AutomationCommandId;
    summary: string;
    deprecated: false;
    inputSchema: object;
    resultSchema: object;
    requiredCapabilities: readonly AutomationCapability[];
    allowedSources: readonly AutomationSource[];
    impact: AutomationImpact;
    targetScope: AutomationCommandDescriptor['targetScope'];
    supportsBatch: boolean;
    supportsDryRun: boolean;
    supportsIdempotencyKey: boolean;
    supportsCancellation: boolean;
    supportsDetach: boolean;
    supportsUndo: boolean;
    atomicity: AutomationAtomicity;
    approvalPolicy: AutomationApprovalPolicy;
    mcp: AutomationMcpMetadata;
  }>;
} {
  return {
    apiVersion: AUTOMATION_API_VERSION,
    commands: automationCommandRegistry.map((descriptor) => ({
      commandId: descriptor.commandId,
      summary: descriptor.summary,
      deprecated: descriptor.deprecated,
      inputSchema: descriptor.inputSchema.toJSONSchema(),
      resultSchema: descriptor.resultSchema.toJSONSchema(),
      requiredCapabilities: descriptor.requiredCapabilities,
      allowedSources: descriptor.allowedSources,
      impact: descriptor.impact,
      targetScope: descriptor.targetScope,
      supportsBatch: descriptor.supportsBatch,
      supportsDryRun: descriptor.supportsDryRun,
      supportsIdempotencyKey: descriptor.supportsIdempotencyKey,
      supportsCancellation: descriptor.supportsCancellation,
      supportsDetach: descriptor.supportsDetach,
      supportsUndo: descriptor.supportsUndo,
      atomicity: descriptor.atomicity,
      approvalPolicy: descriptor.approvalPolicy,
      mcp: descriptor.mcp,
    })),
  };
}

/**
 * Generates the declaration consumed by saved scripts. The checked-in source
 * types above remain the canonical declaration; packaging emits this string
 * only after the runtime/console delivery phase chooses its public module id.
 */
export function generateAutomationTypeDeclaration(
  _moduleSpecifier = '@serpent/automation',
): string {
  // Saved scripts must not import internal Zod schemas or app modules merely
  // to receive completions. Keep the generated public declaration standalone.
  void _moduleSpecifier;
  return [
    'export {};',
    '',
    'declare global {',
    '  interface SerpentScriptAsset {',
    '    readonly id: string;',
    '    readonly name: string;',
    '    readonly rating: number;',
    '    readonly favorite: boolean;',
    "    readonly locationKind: 'managed' | 'linked';",
    '    readonly folderId: string | null;',
    '  }',
    '',
    '  interface SerpentScriptAssetSearchPage {',
    '    readonly items: readonly SerpentScriptAsset[];',
    '    readonly total: number;',
    '    readonly offset: number;',
    '    readonly limit: number;',
    '    readonly hasMore: boolean;',
    '  }',
    '',
    '  interface SerpentRatingUpdateResult {',
    '    readonly updatedCount: number;',
    '    readonly skipped: readonly { readonly assetId: string; readonly reason: string }[];',
    '  }',
    '',
    '  interface SerpentScriptAssetMetadata {',
    '    readonly assetId: string;',
    '    readonly rating: number;',
    '    readonly favorite: boolean;',
    "    readonly tags: readonly { readonly id: string; readonly name: string; readonly source: 'user' | 'ai' }[];",
    "    readonly automaticPalette: readonly { readonly hex: string; readonly ratio: number }[];",
    '  }',
    '',
    '  interface SerpentRecentPalette {',
    '    readonly days: number;',
    '    readonly assetCount: number;',
    '    readonly paletteAssetCount: number;',
    '    readonly colors: readonly { readonly hex: string; readonly weight: number; readonly assetCount: number }[];',
    '  }',
    '',
    '  interface SerpentScriptFolder {',
    '    readonly id: string;',
    '    readonly parentId: string | null;',
    '    readonly name: string;',
    '  }',
    '',
    '  interface SerpentScriptFolderPage {',
    '    readonly items: readonly SerpentScriptFolder[];',
    '    readonly total: number;',
    '    readonly offset: number;',
    '    readonly limit: number;',
    '    readonly hasMore: boolean;',
    '  }',
    '',
    '  interface SerpentAutomationApi {',
    '    readonly folders: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<SerpentScriptFolderPage>;',
    '    };',
    '    readonly assets: {',
    '      search(input: { query: string | null; limit?: number; offset?: number }): Promise<SerpentScriptAssetSearchPage>;',
    '      list(input?: { folderId?: string; recursive?: boolean; limit?: number; offset?: number }): Promise<SerpentScriptAssetSearchPage>;',
    '      getMetadata(assetId: string): Promise<SerpentScriptAssetMetadata>;',
    '      setRating(assetIds: readonly string[], rating: 0 | 1 | 2 | 3 | 4 | 5): Promise<SerpentRatingUpdateResult>;',
    '      copyFilePaths(assetIds: readonly string[]): Promise<{ readonly copiedCount: number }>;',
    '      moveToTrash(assetIds: readonly string[]): Promise<{ readonly trashedCount: number }>;',
    '      renameFile(assetId: string, newBaseName: string): Promise<{ readonly assetId: string; readonly name: string }>;',
    "      renameFiles(items: readonly { readonly assetId: string; readonly newBaseName: string }[]): Promise<{ readonly renamedCount: number; readonly skipped: readonly { readonly assetId: string; readonly reason: 'asset_not_found' | 'asset_unavailable' | 'name_conflict' | 'invalid_name' }[] }>;",
    '    };',
    '    readonly trash: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<SerpentScriptAssetSearchPage>;',
    "      restoreIfOriginalVacant(assetIds: readonly string[]): Promise<{ readonly restoredCount: number; readonly skippedCount: number; readonly skipped: readonly { readonly assetId: string; readonly reason: 'original_folder_missing' | 'name_conflict' | 'trash_file_missing' }[] }>;",
    '    };',
    '    readonly palettes: {',
    '      mostFrequent(input?: { days?: number; limit?: number }): Promise<SerpentRecentPalette>;',
    '    };',
    '  }',
    '',
    '  const serpent: SerpentAutomationApi;',
    '}',
    '',
  ].join('\n');
}

/** A future adapter can use this to build the exact Worker envelope. */
export function makeAutomationWorkerRequest(
  requestId: string,
  command: WorkerCommand,
): WorkerRequest {
  return { requestId, command, dispatch: 'automation-readonly' };
}

/** Re-exported for Gateway contract tests without exposing an old CLI surface. */
export const automationWorkerResultSchema = workerResultSchema;
