import { z } from 'zod';

import {
  assetMetadataResultSchema,
  assetSummarySchema,
  collectionSummarySchema,
  extractedMetadataResultSchema,
  filterClauseSchema,
  linkedFolderSummarySchema,
  linkedFolderRuleSchema,
  managedFolderSummarySchema,
  searchQuerySchema,
  searchScopeSchema,
  smartCollectionSummarySchema,
  sortDefinitionSchema,
  tagSummarySchema,
} from '../shared/asset-types';
import type { WorkerCommand, WorkerRequest } from '../shared/protocol/requests';
import { assetAuthorSchema, nameConflictDecisionSchema, sourcePageUrlSchema } from '../shared/protocol/requests';
import {
  CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH,
  CONTENT_REPLACE_BATCH_MAX_ITEMS,
  CONTENT_REPLACE_MAX_BYTES,
  CONTENT_REPLACE_MAX_BASE64_LENGTH,
  CONTENT_REPLACE_STAGE_CHUNK_MAX_BASE64_LENGTH,
} from '../shared/content-replace';
import {
  aiJobSchema,
  importCompletionSchema,
  importConflictPlanSchema,
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
const idempotencyKeySchema = nonBlankString.max(128);

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
  'plugin',
]);
export type AutomationSource = z.infer<typeof automationSourceSchema>;

export const automationCapabilitySchema = z.enum([
  'library.create',
  'library.read',
  'folder.read',
  'folder.write',
  'asset.read',
  'content.read',
  'content.write',
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
  'ui.notify',
]);
export type AutomationCapability = z.infer<typeof automationCapabilitySchema>;

export type AutomationRiskTier = 'safe' | 'controlled' | 'critical';

export interface AutomationCapabilityDefinition {
  capability: AutomationCapability;
  displayName: string;
  description: string;
  riskTier: Exclude<AutomationRiskTier, 'critical'>;
  defaultPolicy: 'allow' | 'ask';
  canPersist: boolean;
}

/**
 * The single user-facing capability catalogue. Commands declare capability IDs
 * below; settings, MCP and approval UI must consume this catalogue instead of
 * maintaining parallel lists.
 */
export const automationCapabilityRegistry = [
  {
    capability: 'library.create',
    displayName: '创建资源库',
    description: '创建并打开一个新的资源库。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'library.read',
    displayName: '读取资源库',
    description: '读取资源库的结构和状态。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'folder.read',
    displayName: '读取文件夹',
    description: '读取资源库文件夹和链接文件夹。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'folder.write',
    displayName: '修改文件夹',
    description: '创建或修改资源库中的文件夹。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'asset.read',
    displayName: '读取资产',
    description: '读取资产列表、搜索结果和资产状态。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'content.read',
    displayName: '读取资产内容',
    description: '读取资产内容或内容派生信息。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'content.write',
    displayName: '修改资产内容',
    description: '替换、暂存或修改受 Serpent 管理的资产文件。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'metadata.read',
    displayName: '读取元数据',
    description: '读取资产的元数据和 AI 内容。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'tag.read',
    displayName: '读取标签',
    description: '读取标签及其使用关系。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'collection.read',
    displayName: '读取合集',
    description: '读取合集及其成员关系。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'job.read',
    displayName: '读取任务',
    description: '读取媒体、AI 和其他后台任务状态。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
  {
    capability: 'metadata.write',
    displayName: '修改元数据',
    description: '修改描述、评分、喜欢和其他资产元数据。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'tag.write',
    displayName: '修改标签',
    description: '创建、分配或移除标签。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'collection.write',
    displayName: '修改合集',
    description: '创建合集或修改合集成员关系。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'ai.enqueue',
    displayName: '发起 AI 分析',
    description: '将资产加入 AI 分析队列。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'job.manage',
    displayName: '管理后台任务',
    description: '暂停、恢复或取消后台任务。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'file.import',
    displayName: '导入文件',
    description: '从用户选择的磁盘位置导入文件或文件夹。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'file.move',
    displayName: '移动文件',
    description: '移动受 Serpent 管理的资产文件。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'file.rename',
    displayName: '重命名文件',
    description: '重命名受 Serpent 管理的资产文件。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'trash.write',
    displayName: '移入回收站',
    description: '将资产移入 Serpent 回收站，以便后续恢复或清理。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'clipboard.write',
    displayName: '写入剪贴板',
    description: '将资产路径等结果写入操作系统剪贴板。',
    riskTier: 'controlled',
    defaultPolicy: 'ask',
    canPersist: true,
  },
  {
    capability: 'ui.notify',
    displayName: '向桌面显示提示',
    description: '在 Serpent 桌面显示受限的信息提示。',
    riskTier: 'safe',
    defaultPolicy: 'allow',
    canPersist: false,
  },
] as const satisfies readonly AutomationCapabilityDefinition[];

export type AutomationCriticalOperationId =
  | 'library.delete-from-disk'
  | 'folder.delete-from-disk'
  | 'linked-folder.delete-from-disk'
  | 'asset.delete-from-disk'
  | 'asset.delete-permanent'
  | 'asset.delete-linked-source'
  | 'trash.purge';

export interface AutomationCriticalOperationDefinition {
  operation: AutomationCriticalOperationId;
  displayName: string;
  description: string;
  riskTier: 'critical';
  canPersist: false;
  exposedToMcp: boolean;
}

/** Critical operations are deliberately separate from ordinary capabilities. */
export const automationCriticalOperationRegistry = [
  {
    operation: 'library.delete-from-disk',
    displayName: '从磁盘删除资源库',
    description: '删除整个资源库目录；链接源目录不属于删除范围。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: true,
  },
  {
    operation: 'folder.delete-from-disk',
    displayName: '从磁盘删除文件夹',
    description: '删除文件夹及其托管资产；不会进入应用回收站。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: false,
  },
  {
    operation: 'linked-folder.delete-from-disk',
    displayName: '从磁盘删除链接文件夹内容',
    description: '删除链接文件夹子树的源文件；不删除链接规则本身。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: false,
  },
  {
    operation: 'asset.delete-from-disk',
    displayName: '从磁盘删除资产',
    description: '永久删除所选资产文件，不进入应用回收站。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: false,
  },
  {
    operation: 'asset.delete-permanent',
    displayName: '永久删除回收站资产',
    description: '从应用回收站中永久删除所选资产。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: true,
  },
  {
    operation: 'asset.delete-linked-source',
    displayName: '删除链接资产源文件',
    description: '永久删除链接资产对应的源文件。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: false,
  },
  {
    operation: 'trash.purge',
    displayName: '清空回收站',
    description: '永久删除应用回收站中的全部资产。',
    riskTier: 'critical',
    canPersist: false,
    exposedToMcp: false,
  },
] as const satisfies readonly AutomationCriticalOperationDefinition[];

const automationCapabilityDefinitionsById = new Map<string, AutomationCapabilityDefinition>(
  automationCapabilityRegistry.map((definition) => [definition.capability, definition]),
);

if (automationCapabilityDefinitionsById.size !== automationCapabilityRegistry.length
  || automationCapabilityDefinitionsById.size !== automationCapabilitySchema.options.length
  || automationCapabilitySchema.options.some((capability) => !automationCapabilityDefinitionsById.has(capability))) {
  throw new Error('Automation capability registry is incomplete or contains duplicate IDs.');
}

export function getAutomationCapabilityDefinition(
  capability: string,
): AutomationCapabilityDefinition | undefined {
  return automationCapabilityDefinitionsById.get(capability);
}

/** Immutable proof produced and approved by Main immediately before a file write. */
export interface AutomationFileOperationPlanProof {
  planHash: string;
  expectedChangeSequence: number;
  assetStates: Array<{ assetId: string; stateToken: string }>;
  importPlan?: {
    planHash: string;
    expectedChangeSequence: number;
    sourceStates: Array<{ sourcePath: string; stateToken: string }>;
  };
}

export type AutomationImpact = 'read' | 'metadata-write' | 'file-write' | 'destructive' | 'external-effect';
export type AutomationApprovalPolicy = 'none' | 'execution' | 'plan' | 'forbidden';
export type AutomationAtomicity = 'single-transaction' | 'recoverable-file-operation' | 'best-effort';

export const automationCommandInputSchemas = {
  'library.create': z.strictObject({
    displayName: nonBlankString.max(255),
    selectedParentPath: nonBlankString,
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  'library.list-open': noInputSchema,
  'library.list-recent': noInputSchema,
  'library.open': z.strictObject({
    libraryId: z.string().uuid().optional(),
  }),
  'library.close': noInputSchema,
  'library.rename': z.strictObject({ displayName: nonBlankString.max(255) }),
  'library.delete-from-disk': noInputSchema,
  'library.export': z.strictObject({
    destinationPath: nonBlankString,
    format: z.enum(['folder', 'zip']),
    includeLinkedContent: z.boolean().default(false),
  }),
  'library.import-folder': z.strictObject({
    sourceFolderPath: nonBlankString,
    copyToParentPath: nonBlankString.optional(),
  }),
  'library.import-zip': z.strictObject({
    sourceZipPath: nonBlankString,
    destinationParentPath: nonBlankString,
  }),
  'library.show-in-desktop': z.strictObject({
    libraryId: z.string().uuid(),
  }),
  'file.import': z.strictObject({
    sourceKind: z.enum(['files', 'folder']),
    sourcePaths: z.array(nonBlankString).min(1).max(1_000),
    targetFolderId: nonBlankString.optional(),
    imageSequenceFps: z.number().int().min(1).max(240).optional(),
    expandImageSequences: z.boolean().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  }),
  'library.inspect': noInputSchema,
  'library.change-sequence': noInputSchema,
  'execution.status': z.strictObject({
    executionId: nonBlankString.optional(),
  }),
  'ui.notify': z.strictObject({
    severity: z.enum(['info', 'warning', 'error']),
    message: z.string().min(1).max(500),
    // Serpent review: the accepted stateless design keeps ui.notify strictly
    // non-blocking — the old dialog mode (blocking error window) was removed.
    mode: z.literal('toast').default('toast'),
    title: z.string().min(1).max(120).optional(),
  }),
  'folder.list': paginatedInputSchema({}),
  'linked-folder.list': paginatedInputSchema({}),
  'asset.list': paginatedInputSchema({
    folderId: nonBlankString.optional(),
    recursive: z.boolean().default(false),
  }),
  'asset.metadata.get': z.strictObject({ assetId: nonBlankString }),
  'asset.ai-content.get': z.strictObject({ assetId: nonBlankString }),
  'asset.metadata.set': z.strictObject({
    assetId: nonBlankString,
    expectedVersion: z.number().int().min(0),
    description: z.string().max(10_000).nullable().optional(),
    rating: z.number().int().min(0).max(5).optional(),
    favorite: z.boolean().optional(),
    sourcePageUrl: sourcePageUrlSchema.nullable().optional(),
    author: assetAuthorSchema.nullable().optional(),
  }),
  'asset.metadata.set-many': z.strictObject({
    items: z.array(z.strictObject({
      assetId: nonBlankString,
      expectedVersion: z.number().int().min(0),
      description: z.string().max(10_000).nullable().optional(),
      rating: z.number().int().min(0).max(5).optional(),
      favorite: z.boolean().optional(),
      sourcePageUrl: sourcePageUrlSchema.nullable().optional(),
      author: assetAuthorSchema.nullable().optional(),
    })).min(1).max(10_000),
  }),
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
  'asset.delete-permanent': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'asset.content.replace': z.strictObject({
    assetId: nonBlankString,
    dataBase64: z.string().min(1).max(CONTENT_REPLACE_MAX_BASE64_LENGTH),
    expectedRevisionId: nonBlankString.optional(),
    mimeHint: z.string().max(128).optional(),
  }),
  'asset.content.stage': z.strictObject({
    assetId: nonBlankString,
    stagingToken: nonBlankString.optional(),
    dataBase64: z.string().min(1).max(CONTENT_REPLACE_STAGE_CHUNK_MAX_BASE64_LENGTH),
    complete: z.boolean().default(false),
  }),
  'asset.content.replace-batch': z.strictObject({
    items: z.array(z.union([
      z.strictObject({
        assetId: nonBlankString,
        dataBase64: z.string().min(1).max(CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH),
        expectedRevisionId: nonBlankString,
      }),
      z.strictObject({
        assetId: nonBlankString,
        stagingToken: nonBlankString,
        expectedRevisionId: nonBlankString,
      }),
    ])).min(1).max(CONTENT_REPLACE_BATCH_MAX_ITEMS).refine(
      (items) => new Set(items.map((item) => item.assetId)).size === items.length,
      { message: 'items must not contain duplicate assetIds.' },
    ).refine(
      (items) => items.reduce((total, item) => total + ('dataBase64' in item ? item.dataBase64.length : 0), 0)
        <= CONTENT_REPLACE_BATCH_INLINE_MAX_BASE64_LENGTH,
      { message: 'Inline batch content exceeds the IPC payload budget; use staging tokens.' },
    ),
  }),
  'asset.content.read': z.strictObject({
    assetId: nonBlankString,
    maxBytes: z.number().int().positive().max(CONTENT_REPLACE_MAX_BYTES).default(CONTENT_REPLACE_MAX_BYTES),
  }),
  'asset.move': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
    targetFolderId: z.string().uuid().nullable(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
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
  'tag.create': z.strictObject({
    name: nonBlankString.max(255),
  }),
  'tag.rename': z.strictObject({ tagId: nonBlankString, name: nonBlankString.max(255) }),
  'tag.delete': z.strictObject({ tagId: nonBlankString }),
  'tag.delete-many': z.strictObject({ tagIds: z.array(nonBlankString).min(1).max(10_000) }),
  'tag.merge': z.strictObject({
    sourceTagIds: z.array(nonBlankString).min(2).max(10_000),
    name: nonBlankString.max(255),
  }),
  'tag.cooccurrence': z.strictObject({
    minWeight: z.number().int().positive().optional(),
    maxNodes: z.number().int().positive().max(500).optional(),
    maxEdges: z.number().int().positive().max(2_000).optional(),
  }),
  'tag.assign': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
    tagIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'tag.remove': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
    tagIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'folder.create': z.strictObject({
    name: nonBlankString.max(255),
    parentFolderId: z.string().uuid().nullable().optional(),
  }),
  'folder.rename': z.strictObject({
    folderId: nonBlankString,
    newName: nonBlankString.max(255),
  }),
  'folder.move': z.strictObject({
    folderIds: z.array(nonBlankString).min(1).max(10_000),
    targetParentFolderId: nonBlankString.nullable(),
    conflictStrategy: z.enum(['keep-both', 'skip']).default('keep-both'),
  }),
  'folder.delete-empty': z.strictObject({
    folderIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'linked-folder.create': z.strictObject({
    sourceRootPath: nonBlankString,
    displayName: nonBlankString.max(255).optional(),
  }),
  'linked-folder.relink': z.strictObject({ folderId: nonBlankString, newRootPath: nonBlankString }),
  'linked-folder.remove': z.strictObject({ folderId: nonBlankString }),
  'linked-folder.rules.get': z.strictObject({ folderId: nonBlankString }),
  'linked-folder.rules.set': z.strictObject({
    folderId: nonBlankString,
    rules: z.array(linkedFolderRuleSchema).max(200),
  }),
  'linked-folder.refresh': noInputSchema,
  'collection.list': paginatedInputSchema({}),
  'collection.create': z.strictObject({
    name: nonBlankString.max(255),
    parentId: nonBlankString.nullable().optional(),
  }),
  'collection.update': z.strictObject({
    collectionId: nonBlankString,
    name: nonBlankString.max(255).optional(),
    parentId: nonBlankString.nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    coverAssetId: nonBlankString.nullable().optional(),
    position: z.number().int().nonnegative().optional(),
  }),
  'collection.reorder': z.strictObject({
    orderedCollectionIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'collection.delete': z.strictObject({ collectionId: nonBlankString }),
  'collection.assets.add': z.strictObject({
    collectionId: nonBlankString,
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'collection.assets.remove': z.strictObject({
    collectionId: nonBlankString,
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'collection.assets.reorder': z.strictObject({
    collectionId: nonBlankString,
    orderedAssetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'collection.assets.list': z.strictObject({
    collectionId: nonBlankString,
    recursive: z.boolean().default(false),
    ...paginationInputFields,
  }),
  'collection.assets.memberships': paginatedInputSchema({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
  }),
  'asset.copy': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000),
    targetFolderId: nonBlankString.nullable(),
    conflictStrategy: nameConflictDecisionSchema.optional(),
  }),
  'asset.thumbnail.get': z.strictObject({ assetId: nonBlankString }),
  'asset.preview.get': z.strictObject({
    assetId: nonBlankString,
    intent: z.enum(['viewer', 'hover']).optional(),
    exrPlane: z.number().int().min(0).max(255).optional(),
    colorSpace: nonBlankString.max(120).optional(),
  }),
  'asset.refresh': noInputSchema,
  'smart-collection.list': paginatedInputSchema({}),
  'smart-collection.create': z.strictObject({
    name: nonBlankString.max(255),
    queryDefinitionJson: nonBlankString.max(65_536),
  }),
  'smart-collection.update': z.strictObject({
    collectionId: nonBlankString,
    name: nonBlankString.max(255).optional(),
    queryDefinitionJson: nonBlankString.max(65_536).optional(),
    position: z.number().int().nonnegative().optional(),
  }),
  'smart-collection.delete': z.strictObject({ collectionId: nonBlankString }),
  'smart-collection.execute': z.strictObject({
    collectionId: nonBlankString,
    scopeMode: z.boolean().optional(),
    ...paginationInputFields,
  }),
  'media.jobs.list': paginatedInputSchema({}),
  'media.jobs.cancel': z.strictObject({
    jobIds: z.array(nonBlankString).min(1).max(10_000).optional(),
  }),
  'ai.jobs.status': paginatedInputSchema({
    jobIds: z.array(nonBlankString).min(1).max(10_000).optional(),
  }),
  'ai.enqueue': z.strictObject({
    assetIds: z.array(nonBlankString).min(1).max(10_000).optional(),
    folderId: nonBlankString.optional(),
    resumePaused: z.boolean().optional(),
  }),
} as const;

const libraryCreateWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.opened'),
  library: internalLibrarySummarySchema,
});

const libraryClosedWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.closed'),
  libraryId: nonBlankString,
});
const libraryRenamedWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.renamed'),
  library: internalLibrarySummarySchema,
});
const libraryDeletedWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.deleted'),
  libraryId: nonBlankString,
  displayName: nonBlankString,
  libraryPath: nonBlankString,
});
const libraryExportedWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.exported'),
  exportId: nonBlankString,
  libraryId: nonBlankString,
  format: z.enum(['folder', 'zip']),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  excludedPreviewCount: z.number().int().nonnegative(),
  includedLinkedContent: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
const libraryImportedWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.imported'),
  importId: nonBlankString,
  libraryId: nonBlankString,
  displayName: nonBlankString,
  libraryPath: nonBlankString,
});

const fileImportWorkerResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import.conflicts'),
    plan: importConflictPlanSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import.completed'),
    completion: importCompletionSchema,
  }),
]);

const libraryListWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.list'),
  libraries: z.array(internalLibrarySummarySchema),
});

const libraryChangeSequenceWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('library.change-sequence'),
  libraryId: nonBlankString,
  changeSequence: z.number().int().nonnegative(),
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

const assetAiContentWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('ai.content.got'),
  assetId: nonBlankString,
  description: z.string().nullable(),
  tags: z.array(nonBlankString),
  rating: z.number().int().min(1).max(5).nullable(),
  modelVersion: nonBlankString.nullable(),
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
  operationId: nonBlankString,
});

const assetDeletePermanentWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.deleted-permanent'),
  deletedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  skippedReasons: z.array(nonBlankString),
});

const assetContentReplaceWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.content.replaced'),
  assetId: nonBlankString,
  revisionId: nonBlankString,
  byteSize: z.number().int().nonnegative(),
});
const assetContentStageWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.content.staged'),
  assetId: nonBlankString,
  stagingToken: nonBlankString,
  byteSize: z.number().int().nonnegative(),
  complete: z.boolean(),
});
const assetContentReplaceBatchWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.content.batch-replaced'),
  operationId: nonBlankString,
  items: z.array(z.strictObject({
    assetId: nonBlankString,
    revisionId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
  })).min(1),
});
const assetContentReadWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.content.read'),
  assetId: nonBlankString,
  revisionId: nonBlankString,
  byteSize: z.number().int().nonnegative(),
  dataBase64: z.string().max(CONTENT_REPLACE_MAX_BASE64_LENGTH),
  truncated: z.boolean(),
  mimeType: z.string().nullable(),
});

const assetMoveWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.moved'),
  movedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  operationId: nonBlankString.nullable(),
  assets: z.array(assetSummarySchema),
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

const mediaJobsCancelWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('media.jobs.cancelled'),
  libraryId: nonBlankString,
  cancelledCount: z.number().int().nonnegative(),
});

const aiJobsWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('ai.jobs.status'),
  libraryId: nonBlankString,
  jobs: z.array(aiJobSchema),
});

const tagCreateWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('tag.created'),
  tag: tagSummarySchema,
});

const tagAssignWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('tag.assigned'),
  assignedCount: z.number().int().nonnegative(),
  skipped: z.array(tagOperationSkipSchema),
});

const tagRemoveWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('tag.removed'),
  removedCount: z.number().int().nonnegative(),
  skipped: z.array(tagOperationSkipSchema),
});

const folderCreateWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('folder.created'),
  folder: managedFolderSummarySchema,
});

const folderRenamedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('folder.renamed'), folder: managedFolderSummarySchema,
});
const folderMovedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('folder.moved'),
  movedCount: z.number().int().nonnegative(), skippedCount: z.number().int().nonnegative(),
  folders: z.array(managedFolderSummarySchema),
});
const folderEmptyDeletedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('folder.empty-deleted'), deletedFolderIds: z.array(nonBlankString),
});

const linkedFolderCreatedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('asset.import-linked.completed'), linkedFolder: linkedFolderSummarySchema,
});
const linkedFolderRemovedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('linked-folder.removed'), folderId: nonBlankString,
  removedAssetCount: z.number().int().nonnegative(),
});
const linkedFolderRelinkedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('linked-folder.relinked'), linkedFolder: linkedFolderSummarySchema,
});
const linkedFolderRulesWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('linked-folder.rules'), rules: z.array(linkedFolderRuleSchema),
});
const linkedFolderRulesUpdatedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('linked-folder.rules.updated'),
  rules: z.array(linkedFolderRuleSchema), hiddenCount: z.number().int().nonnegative(), restoredCount: z.number().int().nonnegative(),
});
const assetRefreshedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('asset.refreshed'),
  changedCount: z.number().int().nonnegative(), missingCount: z.number().int().nonnegative(), assets: z.array(assetSummarySchema),
});

const assetMetadataSetWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.metadata.updated'),
  metadata: assetMetadataResultSchema,
});
const assetMetadataBatchSetWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('asset.metadata.updated-many'),
  metadata: z.array(assetMetadataResultSchema).min(1),
});

const collectionCreateWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('collection.created'),
  collection: collectionSummarySchema,
});
const collectionUpdatedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('collection.updated'), collection: collectionSummarySchema,
});
const collectionReorderedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('collection.reordered'), orderedCollectionIds: z.array(nonBlankString),
});
const collectionDeletedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('collection.deleted'), collectionId: nonBlankString,
});
const collectionAssetsReorderedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('collection.assets.reordered'), collectionId: nonBlankString,
});
const collectionAssetsListWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('collection.assets.list'), assets: z.array(assetSummarySchema),
});

const tagRenamedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('tag.renamed'), tag: tagSummarySchema,
});
const tagDeletedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('tag.deleted'), tagId: nonBlankString,
});
const tagDeletedManyWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('tag.deleted-many'), deletedTagIds: z.array(nonBlankString),
});
const tagMergedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('tag.merged'), tag: tagSummarySchema, mergedTagIds: z.array(nonBlankString),
});
const tagCooccurrenceWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('tag.cooccurrence'), graph: z.unknown(),
});

const smartCollectionCreatedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('smart-collection.created'), collection: smartCollectionSummarySchema,
});
const smartCollectionUpdatedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('smart-collection.updated'), collection: smartCollectionSummarySchema,
});
const smartCollectionDeletedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('smart-collection.deleted'), collectionId: nonBlankString,
});
const smartCollectionExecutedWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('smart-collection.executed'),
  items: z.array(assetSummarySchema), total: z.number().int().nonnegative(), offset: z.number().int().nonnegative(),
});
const assetCopyWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('asset.copied'),
  copiedCount: z.number().int().nonnegative(), skippedCount: z.number().int().nonnegative(),
  operationId: nonBlankString.nullable(), assets: z.array(assetSummarySchema),
});
const mediaThumbnailArtifactWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('media.thumbnail-artifact'), artifactId: nonBlankString,
  filePath: nonBlankString, width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable(),
});
const mediaPreviewArtifactWorkerResultSchema = z.strictObject({
  ok: z.literal(true), type: z.literal('media.preview-artifact'),
  assetId: nonBlankString, mediaType: z.enum(['image', 'video', 'audio', 'text', 'model', 'other']),
  status: z.enum(['ready', 'pending', 'failed', 'missing']), kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
  artifactId: nonBlankString.optional(), posterArtifactId: nonBlankString.optional(), mimeType: nonBlankString,
  errorCode: nonBlankString.optional(), playbackMode: z.enum(['source', 'proxy']).optional(),
  sourceRevisionId: nonBlankString.optional(), sourceMimeType: nonBlankString.optional(),
  sourceContainer: z.enum(['mp4', 'mov', 'webm']).optional(), sourceCodecs: z.array(nonBlankString).optional(),
});

const collectionAssetsAddWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('collection.assets.added'),
  collectionId: nonBlankString,
});

const collectionAssetsRemoveWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('collection.assets.removed'),
  collectionId: nonBlankString,
});

const aiEnqueueWorkerResultSchema = z.strictObject({
  ok: z.literal(true),
  type: z.literal('ai.jobs.enqueued'),
  libraryId: nonBlankString,
  enqueued: z.number().int().nonnegative(),
  jobIds: z.array(nonBlankString),
  alreadyPendingJobIds: z.array(nonBlankString),
  skippedAssetIds: z.array(nonBlankString),
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
  'library.create': z.strictObject({
    libraryId: nonBlankString,
    displayName: nonBlankString,
    contextRevision: z.number().int().nonnegative().optional(),
  }),
  'library.list-open': z.strictObject({
    libraries: z.array(z.strictObject({
      libraryId: nonBlankString,
      displayName: nonBlankString,
      active: z.boolean(),
    })).max(64),
    activeLibraryId: nonBlankString.nullable(),
    contextRevision: z.number().int().nonnegative(),
  }),
  'library.list-recent': z.array(z.strictObject({
    libraryId: nonBlankString.nullable(),
    displayName: nonBlankString,
  })),
  'library.open': z.strictObject({
    libraryId: nonBlankString,
    displayName: nonBlankString,
    contextRevision: z.number().int().nonnegative(),
  }),
  'library.show-in-desktop': z.strictObject({
    libraryId: nonBlankString,
    displayName: nonBlankString,
    contextRevision: z.number().int().nonnegative(),
  }),
  'library.close': z.strictObject({ libraryId: nonBlankString, closed: z.literal(true) }),
  'library.rename': z.strictObject({ libraryId: nonBlankString, displayName: nonBlankString }),
  'library.delete-from-disk': z.strictObject({ libraryId: nonBlankString, deleted: z.literal(true) }),
  'library.export': z.strictObject({
    exportId: nonBlankString,
    libraryId: nonBlankString,
    format: z.enum(['folder', 'zip']),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    excludedPreviewCount: z.number().int().nonnegative(),
    includedLinkedContent: z.boolean(),
    durationMs: z.number().int().nonnegative(),
  }),
  'library.import-folder': z.strictObject({ importId: nonBlankString, libraryId: nonBlankString, displayName: nonBlankString }),
  'library.import-zip': z.strictObject({ importId: nonBlankString, libraryId: nonBlankString, displayName: nonBlankString }),
  'file.import': z.union([
    z.strictObject({ status: z.literal('conflicts'), plan: importConflictPlanSchema }),
    z.strictObject({ status: z.literal('completed'), completion: importCompletionSchema }),
  ]),
  'library.inspect': z.strictObject({
    libraryId: nonBlankString,
    displayName: nonBlankString,
  }),
  'library.change-sequence': z.strictObject({
    changeSequence: z.number().int().nonnegative(),
  }),
  'execution.status': z.strictObject({
    executionId: nonBlankString,
    status: z.enum([
      'created',
      'validating',
      'awaiting-authorization',
      'running',
      'awaiting-approval',
      'succeeded',
      'partially-succeeded',
      'failed',
      'cancelled',
      'timed-out',
    ]),
    commandCount: z.number().int().nonnegative(),
    succeededCommandCount: z.number().int().nonnegative(),
    failedCommandCount: z.number().int().nonnegative(),
    lastCommandId: nonBlankString.nullable(),
    failureCode: z.string().nullable(),
    deadlineAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    summary: z.strictObject({
      created: z.number().int().nonnegative().optional(),
      updated: z.number().int().nonnegative().optional(),
      succeeded: z.number().int().nonnegative().optional(),
      failed: z.number().int().nonnegative().optional(),
      skipped: z.number().int().nonnegative().optional(),
      jobs: z.number().int().nonnegative().optional(),
    }).nullable(),
  }),
  'ui.notify': z.strictObject({
    shown: z.literal(true),
    mode: z.literal('toast'),
    severity: z.enum(['info', 'warning', 'error']),
  }),
  'folder.list': paginatedResultSchema(managedFolderSummarySchema),
  'folder.rename': managedFolderSummarySchema,
  'folder.move': z.strictObject({ movedCount: z.number().int().nonnegative(), skippedCount: z.number().int().nonnegative(), folders: z.array(managedFolderSummarySchema) }),
  'folder.delete-empty': z.strictObject({ deletedFolderIds: z.array(nonBlankString) }),
  'linked-folder.list': paginatedResultSchema(linkedFolderSummarySchema),
  'linked-folder.create': linkedFolderSummarySchema,
  'linked-folder.relink': linkedFolderSummarySchema,
  'linked-folder.remove': z.strictObject({ folderId: nonBlankString, removedAssetCount: z.number().int().nonnegative() }),
  'linked-folder.rules.get': z.array(linkedFolderRuleSchema),
  'linked-folder.rules.set': z.strictObject({ rules: z.array(linkedFolderRuleSchema), hiddenCount: z.number().int().nonnegative(), restoredCount: z.number().int().nonnegative() }),
  'linked-folder.refresh': z.strictObject({ changedCount: z.number().int().nonnegative(), missingCount: z.number().int().nonnegative(), assets: z.array(assetSummarySchema) }),
  'asset.list': paginatedResultSchema(automationAssetSummarySchema),
  'asset.metadata.get': assetMetadataWorkerResultSchema,
  'asset.ai-content.get': assetAiContentWorkerResultSchema,
  'asset.metadata.set': assetMetadataResultSchema,
  'asset.metadata.set-many': z.array(assetMetadataResultSchema).min(1),
  'asset.extracted-metadata.get': assetExtractedMetadataWorkerResultSchema,
  'asset.search': assetSearchAutomationResultSchema,
  'asset.rating.set': z.strictObject({
    updatedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
  }),
  'asset.paths.copy': z.strictObject({ copiedCount: z.number().int().nonnegative() }),
  'asset.copy': z.strictObject({ copiedCount: z.number().int().nonnegative(), skippedCount: z.number().int().nonnegative(), operationId: nonBlankString.nullable(), assets: z.array(assetSummarySchema) }),
  'asset.thumbnail.get': z.strictObject({ artifactId: nonBlankString, width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable() }),
  'asset.preview.get': z.unknown(),
  'asset.refresh': z.strictObject({ changedCount: z.number().int().nonnegative(), missingCount: z.number().int().nonnegative(), assets: z.array(assetSummarySchema) }),
  'asset.trash': z.strictObject({
    trashedCount: z.number().int().nonnegative(),
    operationId: nonBlankString,
  }),
  'asset.delete-permanent': z.strictObject({
    deletedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    skippedReasons: z.array(nonBlankString),
  }),
  'asset.content.replace': z.strictObject({
    assetId: nonBlankString,
    revisionId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
  }),
  'asset.content.stage': z.strictObject({
    stagingToken: nonBlankString,
    assetId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
    complete: z.boolean(),
  }),
  'asset.content.replace-batch': z.strictObject({
    operationId: nonBlankString,
    items: z.array(z.strictObject({
      assetId: nonBlankString,
      revisionId: nonBlankString,
      byteSize: z.number().int().nonnegative(),
    })).min(1),
  }),
  'asset.content.read': z.strictObject({
    assetId: nonBlankString,
    revisionId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
    dataBase64: z.string().max(CONTENT_REPLACE_MAX_BASE64_LENGTH),
    truncated: z.boolean(),
    mimeType: z.string().nullable(),
  }),
  'asset.move': z.strictObject({
    movedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    operationId: nonBlankString.nullable(),
  }),
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
  'tag.create': z.strictObject({
    id: nonBlankString,
    name: nonBlankString,
    assetCount: z.number().int().nonnegative(),
  }),
  'tag.rename': z.strictObject({ id: nonBlankString, name: nonBlankString, assetCount: z.number().int().nonnegative() }),
  'tag.delete': z.strictObject({ tagId: nonBlankString }),
  'tag.delete-many': z.strictObject({ deletedTagIds: z.array(nonBlankString) }),
  'tag.merge': z.strictObject({ id: nonBlankString, name: nonBlankString, assetCount: z.number().int().nonnegative(), mergedTagIds: z.array(nonBlankString) }),
  'tag.cooccurrence': z.unknown(),
  'tag.assign': z.strictObject({
    assignedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
  }),
  'tag.remove': z.strictObject({
    removedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
  }),
  'folder.create': z.strictObject({
    id: nonBlankString,
    parentId: nonBlankString.nullable(),
    name: nonBlankString,
  }),
  'collection.list': paginatedResultSchema(collectionSummarySchema),
  'collection.create': z.strictObject({
    id: nonBlankString,
    parentId: nonBlankString.nullable(),
    name: nonBlankString,
    assetCount: z.number().int().nonnegative(),
  }),
  'collection.update': collectionSummarySchema,
  'collection.reorder': z.object({ orderedCollectionIds: z.array(nonBlankString) }),
  'collection.delete': z.object({ collectionId: nonBlankString }),
  'collection.assets.add': z.strictObject({
    collectionId: nonBlankString,
  }),
  'collection.assets.remove': z.strictObject({
    collectionId: nonBlankString,
  }),
  'collection.assets.reorder': z.object({ collectionId: nonBlankString }),
  'collection.assets.list': paginatedResultSchema(automationAssetSummarySchema),
  'collection.assets.memberships': paginatedResultSchema(z.strictObject({
    assetId: nonBlankString,
    collectionId: nonBlankString,
  })),
  'smart-collection.list': paginatedResultSchema(smartCollectionSummarySchema),
  'smart-collection.create': smartCollectionSummarySchema,
  'smart-collection.update': smartCollectionSummarySchema,
  'smart-collection.delete': z.object({ collectionId: nonBlankString }),
  'smart-collection.execute': paginatedResultSchema(automationAssetSummarySchema),
  'media.jobs.list': mediaJobsAutomationResultSchema,
  'media.jobs.cancel': z.strictObject({ cancelledCount: z.number().int().nonnegative() }),
  'ai.jobs.status': paginatedResultSchema(aiJobSchema),
  'ai.enqueue': z.strictObject({
    enqueued: z.number().int().nonnegative(),
    jobIds: z.array(nonBlankString),
    alreadyPendingJobIds: z.array(nonBlankString),
    skippedAssetIds: z.array(nonBlankString),
  }),
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
  /** MCP-facing input projection; the internal Automation schema may contain Main-only fields. */
  inputSchema?: z.ZodType;
}

export type AutomationLibraryContext = 'none' | 'active' | 'transition';

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
  /** Serpent-8b5b.2: the command is dangerous — MCP calls require the two-phase agent challenge. */
  criticalOperation?: boolean;
  mcp: AutomationMcpMetadata;
  libraryContext?: AutomationLibraryContext;
  hostCapabilities?: readonly ('desktop-ui')[];
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

const allReadSources = ['desktop-console', 'script', 'mcp', 'test', 'plugin'] as const;
const allInteractiveSources = ['desktop-console', 'script', 'mcp', 'test', 'plugin'] as const;
const lifecycleSources = ['desktop-console', 'script', 'mcp', 'test'] as const;

export const automationCommandRegistry = [
  {
    commandId: 'library.create',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '创建一个资源库并返回其稳定 libraryId；不会建立 MCP session 默认资源库。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['library.create'],
    resultSchema: automationCommandResultSchemas['library.create'],
    workerResultSchema: libraryCreateWorkerResultSchema,
    requiredCapabilities: ['library.create'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'file-write',
    targetScope: 'library',
    supportsBatch: false,
    supportsDryRun: true,
    supportsIdempotencyKey: true,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'recoverable-file-operation',
    approvalPolicy: 'plan',
    mcp: {
      public: false,
      toolName: 'serpent_library_create',
      outputLimit: 1,
      inputSchema: z.strictObject({
        displayName: nonBlankString.max(255),
        selectedParentPath: nonBlankString,
        idempotencyKey: idempotencyKeySchema.optional(),
      }),
    },
    libraryContext: 'transition',
    toWorkerCommand: (_libraryId, input: AutomationCommandInput<'library.create'>) => ({
      type: 'library.create',
      displayName: input.displayName,
      selectedParentPath: input.selectedParentPath,
    }),
    projectResult: (result) => {
      const parsed = libraryCreateWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { libraryId: parsed.data.library.libraryId, displayName: parsed.data.library.displayName }
        : undefined;
    },
  },
  {
    commandId: 'asset.metadata.set-many',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '原子批量更新资产的描述、评分、收藏、来源页与作者。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.metadata.set-many'],
    resultSchema: automationCommandResultSchemas['asset.metadata.set-many'],
    workerResultSchema: assetMetadataBatchSetWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'metadata.read', 'metadata.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: true, toolName: 'serpent_asset_metadata_set_many', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.metadata.set-many'>) => ({
      type: 'asset.metadata.set-many',
      libraryId,
      items: input.items.map((item) => ({
        assetId: item.assetId,
        expectedVersion: item.expectedVersion,
        ...(item.description === undefined ? {} : { description: item.description ?? '' }),
        ...(item.rating === undefined ? {} : { rating: item.rating }),
        ...(item.favorite === undefined ? {} : { favorite: item.favorite }),
        ...(item.sourcePageUrl === undefined ? {} : { sourcePageUrl: item.sourcePageUrl ?? '' }),
        ...(item.author === undefined ? {} : { author: item.author ?? '' }),
      })),
    }),
    projectResult: (result) => {
      const parsed = assetMetadataBatchSetWorkerResultSchema.safeParse(result);
      return parsed.success ? parsed.data.metadata : undefined;
    },
  },
  readDescriptor({
    commandId: 'library.list-open',
    summary: '列出当前已打开的资源库，不返回磁盘路径；没有资源库时返回空列表。',
    inputSchema: automationCommandInputSchemas['library.list-open'],
    resultSchema: automationCommandResultSchemas['library.list-open'],
    workerResultSchema: z.never(),
    requiredCapabilities: [],
    allowedSources: lifecycleSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_library_list_open', outputLimit: 1 },
    libraryContext: 'none',
    toWorkerCommand: () => {
      throw new Error('library.list-open is resolved by Desktop Main.');
    },
    projectResult: () => undefined,
  }),
  readDescriptor({
    commandId: 'library.open',
    summary: '打开指定的已知资源库；不指定 libraryId 时返回需要路径的错误，不打开系统选择器。',
    inputSchema: automationCommandInputSchemas['library.open'],
    resultSchema: automationCommandResultSchemas['library.open'],
    workerResultSchema: z.never(),
    requiredCapabilities: [],
    allowedSources: lifecycleSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_library_open', outputLimit: 1 },
    libraryContext: 'transition',
    toWorkerCommand: () => {
      throw new Error('library.open is resolved by Desktop Main.');
    },
    projectResult: () => undefined,
  }),
  readDescriptor({
    commandId: 'library.show-in-desktop',
    summary: '请求 Desktop 显示指定资源库；不会改变 MCP 后续调用的目标。',
    inputSchema: automationCommandInputSchemas['library.show-in-desktop'],
    resultSchema: automationCommandResultSchemas['library.show-in-desktop'],
    workerResultSchema: z.never(),
    requiredCapabilities: [],
    allowedSources: lifecycleSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_library_show_in_desktop', outputLimit: 1 },
    libraryContext: 'transition',
    toWorkerCommand: () => {
      throw new Error('library.show-in-desktop is resolved by Desktop Main.');
    },
    projectResult: () => undefined,
  }),
  readDescriptor({
    commandId: 'library.list-recent',
    summary: '列出最近使用过的资源库；只返回稳定 ID 和显示名。',
    inputSchema: automationCommandInputSchemas['library.list-recent'],
    resultSchema: automationCommandResultSchemas['library.list-recent'],
    workerResultSchema: z.never(),
    requiredCapabilities: [], allowedSources: lifecycleSources, targetScope: 'library', supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_library_list_recent', outputLimit: 64 }, libraryContext: 'none',
    toWorkerCommand: () => { throw new Error('library.list-recent is resolved by Desktop Main.'); }, projectResult: () => undefined,
  }),
  {
    commandId: 'library.close',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '关闭当前资源库。', deprecated: false,
    inputSchema: automationCommandInputSchemas['library.close'], resultSchema: automationCommandResultSchemas['library.close'], workerResultSchema: libraryClosedWorkerResultSchema,
    requiredCapabilities: ['library.read'], allowedSources: lifecycleSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false,
    atomicity: 'single-transaction', approvalPolicy: 'execution', mcp: { public: true, toolName: 'serpent_library_close', outputLimit: 1 },
    toWorkerCommand: (libraryId) => ({ type: 'library.close', libraryId }),
    projectResult: (result) => { const parsed = libraryClosedWorkerResultSchema.safeParse(result); return parsed.success ? { libraryId: parsed.data.libraryId, closed: true as const } : undefined; },
  },
  {
    commandId: 'library.rename', apiVersion: AUTOMATION_API_VERSION, summary: '重命名当前资源库。', deprecated: false,
    inputSchema: automationCommandInputSchemas['library.rename'], resultSchema: automationCommandResultSchemas['library.rename'], workerResultSchema: libraryRenamedWorkerResultSchema,
    requiredCapabilities: ['library.read'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false,
    atomicity: 'single-transaction', approvalPolicy: 'execution', mcp: { public: true, toolName: 'serpent_library_rename', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'library.rename'>) => ({ type: 'library.rename', libraryId, displayName: input.displayName }),
    projectResult: (result) => { const parsed = libraryRenamedWorkerResultSchema.safeParse(result); return parsed.success ? { libraryId: parsed.data.library.libraryId, displayName: parsed.data.library.displayName } : undefined; },
  },
  {
    commandId: 'library.delete-from-disk', apiVersion: AUTOMATION_API_VERSION,
    summary: '从磁盘永久删除当前资源库及其托管内容；链接源目录不受影响。', deprecated: false,
    inputSchema: automationCommandInputSchemas['library.delete-from-disk'], resultSchema: automationCommandResultSchemas['library.delete-from-disk'], workerResultSchema: libraryDeletedWorkerResultSchema,
    requiredCapabilities: [], allowedSources: ['mcp'], impact: 'destructive', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false,
    atomicity: 'best-effort', approvalPolicy: 'none', criticalOperation: true, mcp: { public: true, toolName: 'serpent_library_delete_from_disk', outputLimit: 1 },
    toWorkerCommand: (libraryId) => ({ type: 'library.delete-from-disk', libraryId }),
    projectResult: (result) => { const parsed = libraryDeletedWorkerResultSchema.safeParse(result); return parsed.success ? { libraryId: parsed.data.libraryId, deleted: true as const } : undefined; },
  },
  {
    commandId: 'library.export', apiVersion: AUTOMATION_API_VERSION, summary: '将当前资源库导出到显式指定的文件夹或 ZIP 路径。', deprecated: false,
    inputSchema: automationCommandInputSchemas['library.export'], resultSchema: automationCommandResultSchemas['library.export'], workerResultSchema: libraryExportedWorkerResultSchema,
    requiredCapabilities: ['library.read'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: true, supportsDetach: true, supportsUndo: false,
    atomicity: 'recoverable-file-operation', approvalPolicy: 'execution', mcp: { public: true, toolName: 'serpent_library_export', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'library.export'>) => ({ type: 'library.export', libraryId, destinationPath: input.destinationPath, format: input.format, includeLinkedContent: input.includeLinkedContent }),
    projectResult: (result) => { const parsed = libraryExportedWorkerResultSchema.safeParse(result); return parsed.success ? { exportId: parsed.data.exportId, libraryId: parsed.data.libraryId, format: parsed.data.format, fileCount: parsed.data.fileCount, totalBytes: parsed.data.totalBytes, excludedPreviewCount: parsed.data.excludedPreviewCount, includedLinkedContent: parsed.data.includedLinkedContent, durationMs: parsed.data.durationMs } : undefined; },
  },
  {
    commandId: 'library.import-folder', apiVersion: AUTOMATION_API_VERSION, summary: '从显式指定的文件夹导入一个已导出的资源库。', deprecated: false,
    inputSchema: automationCommandInputSchemas['library.import-folder'], resultSchema: automationCommandResultSchemas['library.import-folder'], workerResultSchema: libraryImportedWorkerResultSchema,
    requiredCapabilities: ['library.create'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', libraryContext: 'none', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false,
    atomicity: 'recoverable-file-operation', approvalPolicy: 'execution', mcp: { public: true, toolName: 'serpent_library_import_folder', outputLimit: 1 },
    toWorkerCommand: (_libraryId, input: AutomationCommandInput<'library.import-folder'>) => ({ type: 'library.import-folder', sourceFolderPath: input.sourceFolderPath, ...(input.copyToParentPath === undefined ? {} : { copyToParentPath: input.copyToParentPath }) }),
    projectResult: (result) => { const parsed = libraryImportedWorkerResultSchema.safeParse(result); return parsed.success ? { importId: parsed.data.importId, libraryId: parsed.data.libraryId, displayName: parsed.data.displayName } : undefined; },
  },
  {
    commandId: 'library.import-zip', apiVersion: AUTOMATION_API_VERSION, summary: '从显式指定的 ZIP 文件导入一个资源库。', deprecated: false,
    inputSchema: automationCommandInputSchemas['library.import-zip'], resultSchema: automationCommandResultSchemas['library.import-zip'], workerResultSchema: libraryImportedWorkerResultSchema,
    requiredCapabilities: ['library.create'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', libraryContext: 'none', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false,
    atomicity: 'recoverable-file-operation', approvalPolicy: 'execution', mcp: { public: true, toolName: 'serpent_library_import_zip', outputLimit: 1 },
    toWorkerCommand: (_libraryId, input: AutomationCommandInput<'library.import-zip'>) => ({ type: 'library.import-zip', sourceZipPath: input.sourceZipPath, destinationParentPath: input.destinationParentPath }),
    projectResult: (result) => { const parsed = libraryImportedWorkerResultSchema.safeParse(result); return parsed.success ? { importId: parsed.data.importId, libraryId: parsed.data.libraryId, displayName: parsed.data.displayName } : undefined; },
  },
  {
    commandId: 'file.import',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '将文件或目录复制导入当前资源库。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['file.import'],
    resultSchema: automationCommandResultSchemas['file.import'],
    workerResultSchema: fileImportWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'file.import'],
    allowedSources: ['desktop-console', 'script', 'mcp', 'test'],
    impact: 'file-write',
    targetScope: 'library',
    supportsBatch: true,
    supportsDryRun: true,
    supportsIdempotencyKey: true,
    supportsCancellation: true,
    supportsDetach: true,
    // Import recovery references / Worker operationId are not wired yet.
    // Advertising supportsUndo without reversible refs always produces
    // partially-succeeded Undo Groups; keep false until that seam exists.
    supportsUndo: false,
    atomicity: 'recoverable-file-operation',
    approvalPolicy: 'plan',
    mcp: {
      public: false,
      toolName: 'serpent_file_import',
      outputLimit: AUTOMATION_MAX_PAGE_SIZE,
      inputSchema: z.strictObject({
        sourceKind: z.enum(['files', 'folder']),
        sourcePaths: z.array(nonBlankString).min(1).max(1_000),
        targetFolderId: nonBlankString.optional(),
        imageSequenceFps: z.number().int().min(1).max(240).optional(),
        expandImageSequences: z.boolean().optional(),
        idempotencyKey: idempotencyKeySchema.optional(),
      }),
    },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'file.import'>, plan) => ({
      type: 'asset.import.prepare',
      libraryId,
      sourceKind: input.sourceKind,
      sourcePaths: input.sourcePaths,
      ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
      ...(input.imageSequenceFps === undefined ? {} : { imageSequenceFps: input.imageSequenceFps }),
      ...(input.expandImageSequences === undefined ? {} : { expandImageSequences: input.expandImageSequences }),
      ...(plan?.importPlan === undefined ? {} : { automationPlan: plan.importPlan }),
    }),
    projectResult: (result) => {
      const parsed = fileImportWorkerResultSchema.safeParse(result);
      if (!parsed.success) return undefined;
      return parsed.data.type === 'asset.import.conflicts'
        ? { status: 'conflicts', plan: parsed.data.plan }
        : { status: 'completed', completion: parsed.data.completion };
    },
  },
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
    libraryContext: 'active',
    toWorkerCommand: () => ({ type: 'library.list' }),
    projectResult: (result, libraryId) => {
      const parsed = libraryListWorkerResultSchema.safeParse(result);
      const library = parsed.success
        ? parsed.data.libraries.find((entry) => entry.libraryId === libraryId)
        : undefined;
      if (library === undefined) return undefined;
      return { libraryId: library.libraryId, displayName: library.displayName };
    },
  }),
  readDescriptor({
    commandId: 'library.change-sequence',
    summary: '读取当前绑定资源库的持久变更序号，供跨进程刷新与计划过期检测。',
    inputSchema: automationCommandInputSchemas['library.change-sequence'],
    resultSchema: automationCommandResultSchemas['library.change-sequence'],
    workerResultSchema: libraryChangeSequenceWorkerResultSchema,
    requiredCapabilities: ['library.read'],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_library_change_sequence', outputLimit: 1 },
    libraryContext: 'active',
    toWorkerCommand: (libraryId) => ({ type: 'library.change-sequence', libraryId }),
    projectResult: (result) => {
      const parsed = libraryChangeSequenceWorkerResultSchema.safeParse(result);
      return parsed.success ? { changeSequence: parsed.data.changeSequence } : undefined;
    },
  }),
  readDescriptor({
    commandId: 'execution.status',
    summary: '读取当前自动化执行的状态与命令统计（不含路径）。',
    inputSchema: automationCommandInputSchemas['execution.status'],
    resultSchema: automationCommandResultSchemas['execution.status'],
    workerResultSchema: z.never(),
    requiredCapabilities: [],
    allowedSources: allReadSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_execution_status', outputLimit: 1 },
    libraryContext: 'none',
    toWorkerCommand: () => {
      throw new Error('execution.status is resolved by Main and does not dispatch to the Worker.');
    },
    projectResult: () => undefined,
  }),
  readDescriptor({
    commandId: 'ui.notify',
    summary: '向桌面用户显示非阻塞 info/warning/error 提示条（冷静文案，不含绝对路径）。',
    inputSchema: automationCommandInputSchemas['ui.notify'],
    resultSchema: automationCommandResultSchemas['ui.notify'],
    workerResultSchema: z.never(),
    // A bounded local info notice is not a library mutation and must remain
    // available to read-only MCP sessions so an agent can explain what it is
    // waiting for without first requesting write access.
    requiredCapabilities: [],
    allowedSources: allInteractiveSources,
    targetScope: 'library',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_ui_notify', outputLimit: 1 },
    libraryContext: 'none',
    toWorkerCommand: () => {
      throw new Error('ui.notify is resolved by Main and does not dispatch to the Worker.');
    },
    projectResult: () => undefined,
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
    allowedSources: allInteractiveSources,
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
    allowedSources: allInteractiveSources,
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
    allowedSources: allInteractiveSources,
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
      return parsed.success
        ? { trashedCount: parsed.data.trashedCount, operationId: parsed.data.operationId }
        : undefined;
    },
  },
  {
    // Serpent-8b5b.2: the first MCP-exposed dangerous command. It is MCP-only
    // (Desktop uses its own red-confirmation flow), requires explicit target
    // IDs, and every call is gated by the two-phase agent challenge — the
    // first call only returns a risk report bound to the exact call.
    commandId: 'asset.delete-permanent',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '从应用回收站永久删除所选资产；文件不进入磁盘回收站，不可恢复。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.delete-permanent'],
    resultSchema: automationCommandResultSchemas['asset.delete-permanent'],
    workerResultSchema: assetDeletePermanentWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'trash.write'],
    allowedSources: ['mcp'],
    impact: 'destructive',
    targetScope: 'asset-set',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'best-effort',
    approvalPolicy: 'none',
    criticalOperation: true,
    mcp: { public: false, toolName: 'serpent_asset_delete_permanent', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.delete-permanent'>) => ({
      type: 'asset.delete-permanent',
      libraryId,
      assetIds: input.assetIds,
    }),
    projectResult: (result) => {
      const parsed = assetDeletePermanentWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
            deletedCount: parsed.data.deletedCount,
            skippedCount: parsed.data.skippedCount,
            skippedReasons: parsed.data.skippedReasons,
          }
        : undefined;
    },
  },
  {
    commandId: 'asset.content.replace',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '原地替换托管资产的文件内容；需本机计划确认。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.content.replace'],
    resultSchema: automationCommandResultSchemas['asset.content.replace'],
    workerResultSchema: assetContentReplaceWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'content.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_asset_content_replace', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.content.replace'>, plan) => ({
      type: 'asset.content.replace',
      libraryId,
      assetId: input.assetId,
      dataBase64: input.dataBase64,
      ...(input.expectedRevisionId === undefined ? {} : { expectedRevisionId: input.expectedRevisionId }),
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetContentReplaceWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
            assetId: parsed.data.assetId,
            revisionId: parsed.data.revisionId,
            byteSize: parsed.data.byteSize,
          }
        : undefined;
    },
  },
  {
    commandId: 'asset.content.stage',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '以有界分块将待替换内容写入 Worker-owned staging；不会修改资产。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.content.stage'],
    resultSchema: automationCommandResultSchemas['asset.content.stage'],
    workerResultSchema: assetContentStageWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'content.write'],
    allowedSources: allInteractiveSources,
    impact: 'file-write',
    targetScope: 'asset',
    supportsBatch: false,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'best-effort',
    approvalPolicy: 'none',
    mcp: { public: false, toolName: 'serpent_asset_content_stage', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.content.stage'>) => ({
      type: 'asset.content.stage',
      libraryId,
      assetId: input.assetId,
      ...(input.stagingToken === undefined ? {} : { stagingToken: input.stagingToken }),
      dataBase64: input.dataBase64,
      complete: input.complete,
    }),
    projectResult: (result) => {
      const parsed = assetContentStageWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
            stagingToken: parsed.data.stagingToken,
            assetId: parsed.data.assetId,
            byteSize: parsed.data.byteSize,
            complete: parsed.data.complete,
          }
        : undefined;
    },
  },
  {
    commandId: 'asset.content.replace-batch',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '统一预检并一次确认后批量替换托管资产内容。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.content.replace-batch'],
    resultSchema: automationCommandResultSchemas['asset.content.replace-batch'],
    workerResultSchema: assetContentReplaceBatchWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'content.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_asset_content_replace_batch', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.content.replace-batch'>, plan) => ({
      type: 'asset.content.replace-batch',
      libraryId,
      items: input.items,
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetContentReplaceBatchWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { operationId: parsed.data.operationId, items: parsed.data.items }
        : undefined;
    },
  },
  readDescriptor({
    commandId: 'asset.content.read',
    summary: '读取托管资产的有界文件内容，不返回文件路径。',
    inputSchema: automationCommandInputSchemas['asset.content.read'],
    resultSchema: automationCommandResultSchemas['asset.content.read'],
    workerResultSchema: assetContentReadWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'content.read'],
    allowedSources: allReadSources,
    targetScope: 'asset',
    supportsBatch: false,
    mcp: { public: false, toolName: 'serpent_asset_content_read', outputLimit: 1 },
    toWorkerCommand: (libraryId, input) => ({
      type: 'asset.content.read',
      libraryId,
      assetId: input.assetId,
      maxBytes: input.maxBytes,
    }),
    projectResult: (result) => {
      const parsed = assetContentReadWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          assetId: parsed.data.assetId,
          revisionId: parsed.data.revisionId,
          byteSize: parsed.data.byteSize,
          dataBase64: parsed.data.dataBase64,
          truncated: parsed.data.truncated,
          mimeType: parsed.data.mimeType,
        }
        : undefined;
    },
  }),
  {
    commandId: 'asset.move',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '将托管资产移动到目标文件夹；需本机计划确认。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.move'],
    resultSchema: automationCommandResultSchemas['asset.move'],
    workerResultSchema: assetMoveWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'folder.read', 'file.move'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_asset_move', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.move'>, plan) => ({
      type: 'asset.move',
      libraryId,
      assetIds: input.assetIds,
      targetFolderId: input.targetFolderId,
      ...(input.conflictStrategy === undefined ? {} : { conflictStrategy: input.conflictStrategy }),
      ...(plan === undefined ? {} : { automationPlan: plan }),
    }),
    projectResult: (result) => {
      const parsed = assetMoveWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
            movedCount: parsed.data.movedCount,
            skippedCount: parsed.data.skippedCount,
            operationId: parsed.data.operationId,
          }
        : undefined;
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
    allowedSources: allInteractiveSources,
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
    allowedSources: allInteractiveSources,
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
    allowedSources: allInteractiveSources,
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
  {
    commandId: 'folder.create',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '在资源库中创建空托管文件夹。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['folder.create'],
    resultSchema: automationCommandResultSchemas['folder.create'],
    workerResultSchema: folderCreateWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.read', 'folder.write'],
    allowedSources: allInteractiveSources,
    impact: 'file-write',
    targetScope: 'library',
    supportsBatch: false,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_folder_create', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'folder.create'>) => ({
      type: 'folder.create',
      libraryId,
      name: input.name,
      ...(input.parentFolderId === undefined || input.parentFolderId === null
        ? {}
        : { parentFolderId: input.parentFolderId }),
    }),
    projectResult: (result) => {
      const parsed = folderCreateWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          id: parsed.data.folder.folderId,
          parentId: parsed.data.folder.parentFolderId,
          name: parsed.data.folder.name,
        }
        : undefined;
    },
  },
  {
    commandId: 'folder.rename', apiVersion: AUTOMATION_API_VERSION, summary: '重命名托管文件夹并同步其子树路径。', deprecated: false,
    inputSchema: automationCommandInputSchemas['folder.rename'], resultSchema: automationCommandResultSchemas['folder.rename'], workerResultSchema: folderRenamedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'recoverable-file-operation', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_folder_rename', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'folder.rename'>) => ({ type: 'folder.rename', libraryId, folderId: input.folderId, newName: input.newName }),
    projectResult: (result) => { const parsed = folderRenamedWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.folder : undefined; },
  },
  {
    commandId: 'folder.move', apiVersion: AUTOMATION_API_VERSION, summary: '批量移动托管文件夹并更新父级关系。', deprecated: false,
    inputSchema: automationCommandInputSchemas['folder.move'], resultSchema: automationCommandResultSchemas['folder.move'], workerResultSchema: folderMovedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'recoverable-file-operation', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_folder_move', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'folder.move'>) => ({ type: 'folder.move', libraryId, folderIds: input.folderIds, targetParentFolderId: input.targetParentFolderId, conflictStrategy: input.conflictStrategy }),
    projectResult: (result) => { const parsed = folderMovedWorkerResultSchema.safeParse(result); return parsed.success ? { movedCount: parsed.data.movedCount, skippedCount: parsed.data.skippedCount, folders: parsed.data.folders } : undefined; },
  },
  {
    commandId: 'folder.delete-empty', apiVersion: AUTOMATION_API_VERSION, summary: '删除空托管文件夹；含资产、子文件夹或磁盘文件时安全拒绝。', deprecated: false,
    inputSchema: automationCommandInputSchemas['folder.delete-empty'], resultSchema: automationCommandResultSchemas['folder.delete-empty'], workerResultSchema: folderEmptyDeletedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'recoverable-file-operation', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_folder_delete_empty', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'folder.delete-empty'>) => ({ type: 'folder.delete-empty', libraryId, folderIds: input.folderIds }),
    projectResult: (result) => { const parsed = folderEmptyDeletedWorkerResultSchema.safeParse(result); return parsed.success ? { deletedFolderIds: parsed.data.deletedFolderIds } : undefined; },
  },
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
  {
    commandId: 'linked-folder.create', apiVersion: AUTOMATION_API_VERSION, summary: '把显式指定的磁盘目录作为链接文件夹加入当前资源库。', deprecated: false,
    inputSchema: automationCommandInputSchemas['linked-folder.create'], resultSchema: automationCommandResultSchemas['linked-folder.create'], workerResultSchema: linkedFolderCreatedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false, atomicity: 'recoverable-file-operation', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_linked_folder_create', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'linked-folder.create'>) => ({ type: 'asset.import-linked', libraryId, sourceRootPath: input.sourceRootPath, ...(input.displayName === undefined ? {} : { displayName: input.displayName }) }),
    projectResult: (result) => { const parsed = linkedFolderCreatedWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.linkedFolder : undefined; },
  },
  {
    commandId: 'linked-folder.relink', apiVersion: AUTOMATION_API_VERSION, summary: '更新链接文件夹源目录并重新扫描。', deprecated: false,
    inputSchema: automationCommandInputSchemas['linked-folder.relink'], resultSchema: automationCommandResultSchemas['linked-folder.relink'], workerResultSchema: linkedFolderRelinkedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false, atomicity: 'recoverable-file-operation', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_linked_folder_relink', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'linked-folder.relink'>) => ({ type: 'linked-folder.relink', libraryId, folderId: input.folderId, newRootPath: input.newRootPath }),
    projectResult: (result) => { const parsed = linkedFolderRelinkedWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.linkedFolder : undefined; },
  },
  {
    commandId: 'linked-folder.remove', apiVersion: AUTOMATION_API_VERSION, summary: '解除链接文件夹索引，不删除源文件。', deprecated: false,
    inputSchema: automationCommandInputSchemas['linked-folder.remove'], resultSchema: automationCommandResultSchemas['linked-folder.remove'], workerResultSchema: linkedFolderRemovedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_linked_folder_remove', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'linked-folder.remove'>) => ({ type: 'linked-folder.remove', libraryId, folderId: input.folderId }),
    projectResult: (result) => { const parsed = linkedFolderRemovedWorkerResultSchema.safeParse(result); return parsed.success ? { folderId: parsed.data.folderId, removedAssetCount: parsed.data.removedAssetCount } : undefined; },
  },
  readDescriptor({
    commandId: 'linked-folder.rules.get', summary: '读取链接文件夹过滤规则。', inputSchema: automationCommandInputSchemas['linked-folder.rules.get'], resultSchema: automationCommandResultSchemas['linked-folder.rules.get'], workerResultSchema: linkedFolderRulesWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.read'], allowedSources: allReadSources, targetScope: 'library', supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_linked_folder_rules_get', outputLimit: 200 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'linked-folder.rules.get'>) => ({ type: 'linked-folder.rules.get', libraryId, folderId: input.folderId }),
    projectResult: (result) => { const parsed = linkedFolderRulesWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.rules : undefined; },
  }),
  {
    commandId: 'linked-folder.rules.set', apiVersion: AUTOMATION_API_VERSION, summary: '替换链接文件夹过滤规则并刷新索引。', deprecated: false,
    inputSchema: automationCommandInputSchemas['linked-folder.rules.set'], resultSchema: automationCommandResultSchemas['linked-folder.rules.set'], workerResultSchema: linkedFolderRulesUpdatedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_linked_folder_rules_set', outputLimit: 200 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'linked-folder.rules.set'>) => ({ type: 'linked-folder.rules.set', libraryId, folderId: input.folderId, rules: input.rules }),
    projectResult: (result) => { const parsed = linkedFolderRulesUpdatedWorkerResultSchema.safeParse(result); return parsed.success ? { rules: parsed.data.rules, hiddenCount: parsed.data.hiddenCount, restoredCount: parsed.data.restoredCount } : undefined; },
  },
  {
    commandId: 'linked-folder.refresh', apiVersion: AUTOMATION_API_VERSION, summary: '重新扫描当前资源库链接资产。', deprecated: false,
    inputSchema: automationCommandInputSchemas['linked-folder.refresh'], resultSchema: automationCommandResultSchemas['linked-folder.refresh'], workerResultSchema: assetRefreshedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false, atomicity: 'best-effort', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_linked_folder_refresh', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'asset.refresh', libraryId }),
    projectResult: (result) => { const parsed = assetRefreshedWorkerResultSchema.safeParse(result); return parsed.success ? { changedCount: parsed.data.changedCount, missingCount: parsed.data.missingCount, assets: parsed.data.assets } : undefined; },
  },
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
  {
    commandId: 'asset.copy', apiVersion: AUTOMATION_API_VERSION, summary: '把一批托管资产复制到目标文件夹。', deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.copy'], resultSchema: automationCommandResultSchemas['asset.copy'], workerResultSchema: assetCopyWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'folder.write'], allowedSources: allInteractiveSources, impact: 'file-write', targetScope: 'asset-set', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false, atomicity: 'recoverable-file-operation', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_asset_copy', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.copy'>) => ({ type: 'asset.copy', libraryId, assetIds: input.assetIds, targetFolderId: input.targetFolderId, ...(input.conflictStrategy === undefined ? {} : { conflictStrategy: input.conflictStrategy }) }),
    projectResult: (result) => { const parsed = assetCopyWorkerResultSchema.safeParse(result); return parsed.success ? { copiedCount: parsed.data.copiedCount, skippedCount: parsed.data.skippedCount, operationId: parsed.data.operationId, assets: parsed.data.assets } : undefined; },
  },
  readDescriptor({
    commandId: 'asset.thumbnail.get', summary: '读取资产缩略图派生物信息。', inputSchema: automationCommandInputSchemas['asset.thumbnail.get'], resultSchema: automationCommandResultSchemas['asset.thumbnail.get'], workerResultSchema: mediaThumbnailArtifactWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'content.read'], allowedSources: allReadSources, targetScope: 'asset', supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_asset_thumbnail_get', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.thumbnail.get'>) => ({ type: 'media.get-thumbnail-artifact', libraryId, assetId: input.assetId }),
    projectResult: (result) => { const parsed = mediaThumbnailArtifactWorkerResultSchema.safeParse(result); return parsed.success ? { artifactId: parsed.data.artifactId, width: parsed.data.width, height: parsed.data.height } : undefined; },
  }),
  {
    commandId: 'asset.preview.get', apiVersion: AUTOMATION_API_VERSION, summary: '读取资产预览/代理状态；必要时提交幂等的预览生成提示。', deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.preview.get'], resultSchema: automationCommandResultSchemas['asset.preview.get'], workerResultSchema: mediaPreviewArtifactWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'content.read'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'asset', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false, atomicity: 'best-effort', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_asset_preview_get', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.preview.get'>) => ({ type: 'media.get-preview-artifact', libraryId, assetId: input.assetId, ...(input.intent === undefined ? {} : { intent: input.intent }), ...(input.exrPlane === undefined ? {} : { exrPlane: input.exrPlane }), ...(input.colorSpace === undefined ? {} : { colorSpace: input.colorSpace }) }),
    projectResult: (result) => { const parsed = mediaPreviewArtifactWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data : undefined; },
  },
  {
    commandId: 'asset.refresh', apiVersion: AUTOMATION_API_VERSION, summary: '重新扫描当前资源库的托管与链接资产。', deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.refresh'], resultSchema: automationCommandResultSchemas['asset.refresh'], workerResultSchema: assetRefreshedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: true, supportsUndo: false, atomicity: 'best-effort', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_asset_refresh', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId) => ({ type: 'asset.refresh', libraryId }),
    projectResult: (result) => { const parsed = assetRefreshedWorkerResultSchema.safeParse(result); return parsed.success ? { changedCount: parsed.data.changedCount, missingCount: parsed.data.missingCount, assets: parsed.data.assets } : undefined; },
  },
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
    commandId: 'asset.ai-content.get',
    summary: '读取一项资产当前的 AI 分析结果（描述、标签和建议评分）。',
    inputSchema: automationCommandInputSchemas['asset.ai-content.get'],
    resultSchema: automationCommandResultSchemas['asset.ai-content.get'],
    workerResultSchema: assetAiContentWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read'],
    allowedSources: allReadSources,
    targetScope: 'asset',
    supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_asset_ai_content_get', outputLimit: 1 },
    toWorkerCommand: (libraryId, input) => ({ type: 'ai.content.get', libraryId, assetId: input.assetId }),
    projectResult: (result) => assetAiContentWorkerResultSchema.safeParse(result).data,
  }),
  {
    commandId: 'asset.metadata.set',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '更新一项资产的用户元数据（描述、评分、收藏、来源页与作者）。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['asset.metadata.set'],
    resultSchema: automationCommandResultSchemas['asset.metadata.set'],
    workerResultSchema: assetMetadataSetWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'metadata.read', 'metadata.write'],
    allowedSources: allInteractiveSources,
    impact: 'metadata-write',
    targetScope: 'asset',
    supportsBatch: false,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_asset_metadata_set', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'asset.metadata.set'>) => ({
      type: 'asset.metadata.set',
      libraryId,
      assetId: input.assetId,
      expectedVersion: input.expectedVersion,
      ...(input.description === undefined
        ? {}
        : { description: input.description === null ? '' : input.description }),
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      ...(input.favorite === undefined ? {} : { favorite: input.favorite }),
      ...(input.sourcePageUrl === undefined
        ? {}
        : { sourcePageUrl: input.sourcePageUrl === null ? '' : input.sourcePageUrl }),
      ...(input.author === undefined
        ? {}
        : { author: input.author === null ? '' : input.author }),
    }),
    projectResult: (result) => {
      const parsed = assetMetadataSetWorkerResultSchema.safeParse(result);
      return parsed.success ? parsed.data.metadata : undefined;
    },
  },
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
  {
    commandId: 'tag.create',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '创建新标签。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.create'],
    resultSchema: automationCommandResultSchemas['tag.create'],
    workerResultSchema: tagCreateWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.read', 'tag.write'],
    allowedSources: allInteractiveSources,
    impact: 'metadata-write',
    targetScope: 'library',
    supportsBatch: false,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_tag_create', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.create'>) => ({
      type: 'tag.create',
      libraryId,
      name: input.name,
    }),
    projectResult: (result) => {
      const parsed = tagCreateWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          id: parsed.data.tag.tagId,
          name: parsed.data.tag.name,
          assetCount: parsed.data.tag.assetCount,
        }
      : undefined;
    },
  },
  {
    commandId: 'tag.rename', apiVersion: AUTOMATION_API_VERSION, summary: '重命名标签。', deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.rename'], resultSchema: automationCommandResultSchemas['tag.rename'], workerResultSchema: tagRenamedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_tag_rename', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.rename'>) => ({ type: 'tag.rename', libraryId, tagId: input.tagId, name: input.name }),
    projectResult: (result) => { const parsed = tagRenamedWorkerResultSchema.safeParse(result); return parsed.success ? { id: parsed.data.tag.tagId, name: parsed.data.tag.name, assetCount: parsed.data.tag.assetCount } : undefined; },
  },
  {
    commandId: 'tag.delete', apiVersion: AUTOMATION_API_VERSION, summary: '删除一个标签并解除其资产关系。', deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.delete'], resultSchema: automationCommandResultSchemas['tag.delete'], workerResultSchema: tagDeletedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_tag_delete', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.delete'>) => ({ type: 'tag.delete', libraryId, tagId: input.tagId }),
    projectResult: (result) => { const parsed = tagDeletedWorkerResultSchema.safeParse(result); return parsed.success ? { tagId: parsed.data.tagId } : undefined; },
  },
  {
    commandId: 'tag.delete-many', apiVersion: AUTOMATION_API_VERSION, summary: '批量删除标签并解除其资产关系。', deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.delete-many'], resultSchema: automationCommandResultSchemas['tag.delete-many'], workerResultSchema: tagDeletedManyWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_tag_delete_many', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.delete-many'>) => ({ type: 'tag.delete-many', libraryId, tagIds: input.tagIds }),
    projectResult: (result) => { const parsed = tagDeletedManyWorkerResultSchema.safeParse(result); return parsed.success ? { deletedTagIds: parsed.data.deletedTagIds } : undefined; },
  },
  {
    commandId: 'tag.merge', apiVersion: AUTOMATION_API_VERSION, summary: '将多个标签合并为一个标签。', deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.merge'], resultSchema: automationCommandResultSchemas['tag.merge'], workerResultSchema: tagMergedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_tag_merge', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.merge'>) => ({ type: 'tag.merge', libraryId, sourceTagIds: input.sourceTagIds, name: input.name }),
    projectResult: (result) => { const parsed = tagMergedWorkerResultSchema.safeParse(result); return parsed.success ? { id: parsed.data.tag.tagId, name: parsed.data.tag.name, assetCount: parsed.data.tag.assetCount, mergedTagIds: parsed.data.mergedTagIds } : undefined; },
  },
  readDescriptor({
    commandId: 'tag.cooccurrence', summary: '读取标签共现关系图，用于发现孤立或重复标签。', inputSchema: automationCommandInputSchemas['tag.cooccurrence'], resultSchema: automationCommandResultSchemas['tag.cooccurrence'], workerResultSchema: tagCooccurrenceWorkerResultSchema,
    requiredCapabilities: ['library.read', 'tag.read'], allowedSources: allReadSources, targetScope: 'library', supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_tag_cooccurrence', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.cooccurrence'>) => ({ type: 'tag.cooccurrence', libraryId, ...(input.minWeight === undefined ? {} : { minWeight: input.minWeight }), ...(input.maxNodes === undefined ? {} : { maxNodes: input.maxNodes }), ...(input.maxEdges === undefined ? {} : { maxEdges: input.maxEdges }) }),
    projectResult: (result) => { const parsed = tagCooccurrenceWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.graph : undefined; },
  }),
  {
    commandId: 'tag.assign',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '批量为资产添加标签。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.assign'],
    resultSchema: automationCommandResultSchemas['tag.assign'],
    workerResultSchema: tagAssignWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'tag.read', 'tag.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_tag_assign', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.assign'>) => ({
      type: 'tag.assign',
      libraryId,
      assetIds: input.assetIds,
      tagIds: input.tagIds,
    }),
    projectResult: (result) => {
      const parsed = tagAssignWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { assignedCount: parsed.data.assignedCount, skipped: parsed.data.skipped }
        : undefined;
    },
  },
  {
    commandId: 'tag.remove',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '批量从资产移除标签。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['tag.remove'],
    resultSchema: automationCommandResultSchemas['tag.remove'],
    workerResultSchema: tagRemoveWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'tag.read', 'tag.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_tag_remove', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'tag.remove'>) => ({
      type: 'tag.remove',
      libraryId,
      assetIds: input.assetIds,
      tagIds: input.tagIds,
    }),
    projectResult: (result) => {
      const parsed = tagRemoveWorkerResultSchema.safeParse(result);
      return parsed.success
        ? { removedCount: parsed.data.removedCount, skipped: parsed.data.skipped }
        : undefined;
    },
  },
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
  {
    commandId: 'collection.create',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '创建普通合集。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.create'],
    resultSchema: automationCommandResultSchemas['collection.create'],
    workerResultSchema: collectionCreateWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.read', 'collection.write'],
    allowedSources: allInteractiveSources,
    impact: 'metadata-write',
    targetScope: 'library',
    supportsBatch: false,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_collection_create', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.create'>) => ({
      type: 'collection.create',
      libraryId,
      name: input.name,
      ...(input.parentId === undefined || input.parentId === null
        ? {}
        : { parentId: input.parentId }),
    }),
    projectResult: (result) => {
      const parsed = collectionCreateWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          id: parsed.data.collection.collectionId,
          parentId: parsed.data.collection.parentId,
          name: parsed.data.collection.name,
          assetCount: parsed.data.collection.assetCount,
        }
      : undefined;
    },
  },
  {
    commandId: 'collection.update', apiVersion: AUTOMATION_API_VERSION, summary: '更新合集名称、描述、封面或位置。', deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.update'], resultSchema: automationCommandResultSchemas['collection.update'], workerResultSchema: collectionUpdatedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_collection_update', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.update'>) => ({ type: 'collection.update', libraryId, collectionId: input.collectionId, ...(input.name === undefined ? {} : { name: input.name }), ...(input.parentId === undefined ? {} : { parentId: input.parentId }), ...(input.description === undefined ? {} : { description: input.description }), ...(input.coverAssetId === undefined ? {} : { coverAssetId: input.coverAssetId }), ...(input.position === undefined ? {} : { position: input.position }) }),
    projectResult: (result) => { const parsed = collectionUpdatedWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.collection : undefined; },
  },
  {
    commandId: 'collection.reorder', apiVersion: AUTOMATION_API_VERSION, summary: '按给定顺序重排合集。', deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.reorder'], resultSchema: automationCommandResultSchemas['collection.reorder'], workerResultSchema: collectionReorderedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_collection_reorder', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.reorder'>) => ({ type: 'collection.reorder', libraryId, orderedCollectionIds: input.orderedCollectionIds }),
    projectResult: (result) => { const parsed = collectionReorderedWorkerResultSchema.safeParse(result); return parsed.success ? { orderedCollectionIds: parsed.data.orderedCollectionIds } : undefined; },
  },
  {
    commandId: 'collection.delete', apiVersion: AUTOMATION_API_VERSION, summary: '删除一个合集；资产本身不会被删除。', deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.delete'], resultSchema: automationCommandResultSchemas['collection.delete'], workerResultSchema: collectionDeletedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_collection_delete', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.delete'>) => ({ type: 'collection.delete', libraryId, collectionId: input.collectionId }),
    projectResult: (result) => { const parsed = collectionDeletedWorkerResultSchema.safeParse(result); return parsed.success ? { collectionId: parsed.data.collectionId } : undefined; },
  },
  {
    commandId: 'collection.assets.add',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '将资产加入普通合集。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.assets.add'],
    resultSchema: automationCommandResultSchemas['collection.assets.add'],
    workerResultSchema: collectionAssetsAddWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'collection.read', 'collection.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_collection_assets_add', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.assets.add'>) => ({
      type: 'collection.assets.add',
      libraryId,
      collectionId: input.collectionId,
      assetIds: input.assetIds,
    }),
    projectResult: (result) => {
      const parsed = collectionAssetsAddWorkerResultSchema.safeParse(result);
      return parsed.success ? { collectionId: parsed.data.collectionId } : undefined;
    },
  },
  {
    commandId: 'collection.assets.remove',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '从普通合集移除资产。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.assets.remove'],
    resultSchema: automationCommandResultSchemas['collection.assets.remove'],
    workerResultSchema: collectionAssetsRemoveWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'collection.read', 'collection.write'],
    allowedSources: allInteractiveSources,
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
    mcp: { public: false, toolName: 'serpent_collection_assets_remove', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.assets.remove'>) => ({
      type: 'collection.assets.remove',
      libraryId,
      collectionId: input.collectionId,
      assetIds: input.assetIds,
    }),
    projectResult: (result) => {
      const parsed = collectionAssetsRemoveWorkerResultSchema.safeParse(result);
      return parsed.success ? { collectionId: parsed.data.collectionId } : undefined;
    },
  },
  {
    commandId: 'collection.assets.reorder', apiVersion: AUTOMATION_API_VERSION, summary: '重排合集中的资产。', deprecated: false,
    inputSchema: automationCommandInputSchemas['collection.assets.reorder'], resultSchema: automationCommandResultSchemas['collection.assets.reorder'], workerResultSchema: collectionAssetsReorderedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: true,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_collection_assets_reorder', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.assets.reorder'>) => ({ type: 'collection.assets.reorder', libraryId, collectionId: input.collectionId, orderedAssetIds: input.orderedAssetIds }),
    projectResult: (result) => { const parsed = collectionAssetsReorderedWorkerResultSchema.safeParse(result); return parsed.success ? { collectionId: parsed.data.collectionId } : undefined; },
  },
  readDescriptor({
    commandId: 'collection.assets.list', summary: '列出合集中的资产。', inputSchema: automationCommandInputSchemas['collection.assets.list'], resultSchema: automationCommandResultSchemas['collection.assets.list'], workerResultSchema: collectionAssetsListWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'collection.read'], allowedSources: allReadSources, targetScope: 'library', supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_collection_assets_list', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'collection.assets.list'>) => ({ type: 'collection.assets.list', libraryId, collectionId: input.collectionId, recursive: input.recursive }),
    projectResult: (result, _libraryId, input) => { const parsed = collectionAssetsListWorkerResultSchema.safeParse(result); return parsed.success ? pageFromCompleteList(parsed.data.assets.map(automationAssetSummary), input) : undefined; },
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
  {
    commandId: 'smart-collection.create', apiVersion: AUTOMATION_API_VERSION, summary: '创建按结构化查询自动维护的智能合集。', deprecated: false,
    inputSchema: automationCommandInputSchemas['smart-collection.create'], resultSchema: automationCommandResultSchemas['smart-collection.create'], workerResultSchema: smartCollectionCreatedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_smart_collection_create', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'smart-collection.create'>) => ({ type: 'smart-collection.create', libraryId, name: input.name, queryDefinitionJson: input.queryDefinitionJson }),
    projectResult: (result) => { const parsed = smartCollectionCreatedWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.collection : undefined; },
  },
  {
    commandId: 'smart-collection.update', apiVersion: AUTOMATION_API_VERSION, summary: '更新智能合集名称、规则或排序位置。', deprecated: false,
    inputSchema: automationCommandInputSchemas['smart-collection.update'], resultSchema: automationCommandResultSchemas['smart-collection.update'], workerResultSchema: smartCollectionUpdatedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_smart_collection_update', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'smart-collection.update'>) => ({ type: 'smart-collection.update', libraryId, collectionId: input.collectionId, ...(input.name === undefined ? {} : { name: input.name }), ...(input.queryDefinitionJson === undefined ? {} : { queryDefinitionJson: input.queryDefinitionJson }), ...(input.position === undefined ? {} : { position: input.position }) }),
    projectResult: (result) => { const parsed = smartCollectionUpdatedWorkerResultSchema.safeParse(result); return parsed.success ? parsed.data.collection : undefined; },
  },
  {
    commandId: 'smart-collection.delete', apiVersion: AUTOMATION_API_VERSION, summary: '删除智能合集。', deprecated: false,
    inputSchema: automationCommandInputSchemas['smart-collection.delete'], resultSchema: automationCommandResultSchemas['smart-collection.delete'], workerResultSchema: smartCollectionDeletedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'collection.write'], allowedSources: allInteractiveSources, impact: 'metadata-write', targetScope: 'library', supportsBatch: false,
    supportsDryRun: false, supportsIdempotencyKey: false, supportsCancellation: false, supportsDetach: false, supportsUndo: false, atomicity: 'single-transaction', approvalPolicy: 'execution',
    mcp: { public: true, toolName: 'serpent_smart_collection_delete', outputLimit: 1 },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'smart-collection.delete'>) => ({ type: 'smart-collection.delete', libraryId, collectionId: input.collectionId }),
    projectResult: (result) => { const parsed = smartCollectionDeletedWorkerResultSchema.safeParse(result); return parsed.success ? { collectionId: parsed.data.collectionId } : undefined; },
  },
  readDescriptor({
    commandId: 'smart-collection.execute', summary: '执行智能合集规则并返回匹配资产。', inputSchema: automationCommandInputSchemas['smart-collection.execute'], resultSchema: automationCommandResultSchemas['smart-collection.execute'], workerResultSchema: smartCollectionExecutedWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'collection.read'], allowedSources: allReadSources, targetScope: 'library', supportsBatch: false,
    mcp: { public: true, toolName: 'serpent_smart_collection_execute', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'smart-collection.execute'>) => ({ type: 'smart-collection.execute', libraryId, collectionId: input.collectionId, ...(input.scopeMode === undefined ? {} : { scopeMode: input.scopeMode }), limit: input.limit, offset: input.offset }),
    projectResult: (result, _libraryId, input) => { const parsed = smartCollectionExecutedWorkerResultSchema.safeParse(result); return parsed.success ? { ...pageFromWorkerPage(parsed.data.items.map(automationAssetSummary), parsed.data.total, input) } : undefined; },
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
    commandId: 'media.jobs.cancel',
    summary: '取消排队或运行中的媒体后台任务。',
    inputSchema: automationCommandInputSchemas['media.jobs.cancel'],
    resultSchema: automationCommandResultSchemas['media.jobs.cancel'],
    workerResultSchema: mediaJobsCancelWorkerResultSchema,
    requiredCapabilities: ['library.read', 'job.read', 'job.manage'],
    allowedSources: ['mcp'],
    targetScope: 'library',
    supportsBatch: true,
    mcp: { public: true, toolName: 'serpent_media_jobs_cancel', outputLimit: 1 },
    toWorkerCommand: (libraryId, input) => ({
      type: 'media.cancel-jobs',
      libraryId,
      ...(input.jobIds === undefined ? {} : { jobIds: input.jobIds }),
    }),
    projectResult: (result) => {
      const parsed = mediaJobsCancelWorkerResultSchema.safeParse(result);
      return parsed.success ? { cancelledCount: parsed.data.cancelledCount } : undefined;
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
  {
    commandId: 'ai.enqueue',
    apiVersion: AUTOMATION_API_VERSION,
    summary: '将 AI 分析任务加入队列（可按资产、文件夹或整库范围）。',
    deprecated: false,
    inputSchema: automationCommandInputSchemas['ai.enqueue'],
    resultSchema: automationCommandResultSchemas['ai.enqueue'],
    workerResultSchema: aiEnqueueWorkerResultSchema,
    requiredCapabilities: ['library.read', 'asset.read', 'ai.enqueue'],
    allowedSources: allInteractiveSources,
    impact: 'metadata-write',
    targetScope: 'library',
    supportsBatch: true,
    supportsDryRun: false,
    supportsIdempotencyKey: false,
    supportsCancellation: false,
    supportsDetach: false,
    supportsUndo: false,
    atomicity: 'single-transaction',
    approvalPolicy: 'execution',
    mcp: { public: false, toolName: 'serpent_ai_enqueue', outputLimit: AUTOMATION_MAX_PAGE_SIZE },
    toWorkerCommand: (libraryId, input: AutomationCommandInput<'ai.enqueue'>) => ({
      type: 'ai.enqueue-analysis',
      libraryId,
      ...(input.assetIds === undefined ? {} : { assetIds: input.assetIds }),
      ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
      ...(input.resumePaused === undefined ? {} : { resumePaused: input.resumePaused }),
    }),
    projectResult: (result) => {
      const parsed = aiEnqueueWorkerResultSchema.safeParse(result);
      return parsed.success
        ? {
          enqueued: parsed.data.enqueued,
          jobIds: parsed.data.jobIds,
          alreadyPendingJobIds: parsed.data.alreadyPendingJobIds,
          skippedAssetIds: parsed.data.skippedAssetIds,
        }
        : undefined;
    },
  },
] satisfies readonly AutomationCommandDescriptor[];

const descriptorsById = new Map<string, AutomationCommandDescriptor>(
  automationCommandRegistry.map((descriptor) => [descriptor.commandId, descriptor]),
);

if (descriptorsById.size !== automationCommandRegistry.length) {
  throw new Error('Automation command registry contains duplicate command IDs.');
}

export function getAutomationCommandDescriptor(commandId: string): AutomationCommandDescriptor | undefined {
  return descriptorsById.get(commandId);
}

export interface AutomationCommandPermissionMetadata {
  riskTier: AutomationRiskTier;
  requiresPlan: boolean;
  requiresCriticalConfirmation: boolean;
  requestableCapabilities: readonly AutomationCapability[];
  canPersist: boolean;
}

/**
 * Projects command-level impact into the shared permission vocabulary. A
 * command never becomes critical merely because it writes a file; critical
 * operations must be explicitly registered in automationCriticalOperationRegistry.
 */
export function getAutomationCommandPermissionMetadata(
  descriptor: AutomationCommandDescriptor,
): AutomationCommandPermissionMetadata {
  // Serpent-8b5b.2: critical commands are gated by the two-phase agent
  // challenge instead of requestable capabilities or runtime prompts.
  const riskTier: AutomationRiskTier = descriptor.criticalOperation === true
    ? 'critical'
    : descriptor.impact === 'read' ? 'safe' : 'controlled';
  const requestableCapabilities = riskTier === 'critical'
    ? []
    : descriptor.requiredCapabilities.filter((capability) => {
      const definition = getAutomationCapabilityDefinition(capability);
      return definition?.defaultPolicy === 'ask';
    });
  return {
    riskTier,
    requiresPlan: descriptor.approvalPolicy === 'plan',
    requiresCriticalConfirmation: descriptor.criticalOperation === true,
    requestableCapabilities,
    canPersist: riskTier === 'controlled'
      && requestableCapabilities.every((capability) => getAutomationCapabilityDefinition(capability)?.canPersist === true),
  };
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
    riskTier: AutomationRiskTier;
    requestableCapabilities: readonly AutomationCapability[];
    canPersist: boolean;
    requiresCriticalConfirmation: boolean;
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
      ...getAutomationCommandPermissionMetadata(descriptor),
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
    '    /** Stable file-content revision; metadata edits do not change it. */',
    '    readonly currentRevisionId: string;',
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
    '    readonly description: string | null;',
    '    readonly rating: number;',
    '    readonly favorite: boolean;',
    "    readonly tags: readonly { readonly id: string; readonly name: string; readonly source: 'user' | 'ai' }[];",
    "    readonly automaticPalette: readonly { readonly hex: string; readonly ratio: number }[];",
    '    readonly sourcePageUrl: string | null;',
    '    readonly author: string | null;',
    '    /** Optimistic-concurrency token for the metadata row, not a file revision. */',
    '    readonly entityVersion: number;',
    '    readonly updatedAt: string;',
    '  }',
    '',
    '  interface SerpentAiContent {',
    '    readonly assetId: string;',
    '    readonly description: string | null;',
    '    readonly tags: readonly string[];',
    '    readonly rating: number | null;',
    '    readonly modelVersion: string | null;',
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
    '  interface SerpentScriptLibrary {',
    '    readonly id: string;',
    '    readonly displayName: string;',
    '  }',
    '',
    '  interface SerpentScriptImportResult {',
    "    readonly status: 'conflicts' | 'completed';",
    '    readonly plan?: { readonly importId: string; readonly fileCount: number; readonly totalBytes: number; readonly suspectedDuplicateCount: number; readonly libraryDuplicateCount: number; readonly nameConflictCount: number };',
    '    readonly completion?: { readonly importedCount: number; readonly fileCount: number; readonly assetCount: number; readonly skippedCount: number; readonly replacedCount: number; readonly assets: readonly SerpentScriptAsset[] };',
    '  }',
    '',
    '  interface SerpentScriptTag {',
    '    readonly id: string;',
    '    readonly name: string;',
    '    readonly assetCount: number;',
    '  }',
    '',
    '  interface SerpentScriptTagPage {',
    '    readonly items: readonly SerpentScriptTag[];',
    '    readonly total: number;',
    '    readonly offset: number;',
    '    readonly limit: number;',
    '    readonly hasMore: boolean;',
    '  }',
    '',
    '  interface SerpentTagMutationResult {',
    '    readonly assignedCount?: number;',
    '    readonly removedCount?: number;',
    '    readonly skipped: readonly { readonly assetId: string; readonly reason: string }[];',
    '  }',
    '',
    '  interface SerpentScriptCollection {',
    '    readonly id: string;',
    '    readonly parentId: string | null;',
    '    readonly name: string;',
    '    readonly description: string | null;',
    '    readonly assetCount: number;',
    '    readonly childCollectionCount: number;',
    '  }',
    '',
    '  interface SerpentScriptSmartCollection {',
    '    readonly id: string;',
    '    readonly name: string;',
    '    readonly queryDefinition: string;',
    '    readonly assetCount: number;',
    '  }',
    '',
    '  interface SerpentScriptLinkedFolder {',
    '    readonly id: string;',
    '    readonly name: string;',
    "    readonly status: 'available' | 'offline';",
    '    readonly assetCount: number;',
    '  }',
    '',
    '  interface SerpentScriptExtractedMetadata {',
    '    readonly assetId: string;',
    "    readonly status: 'ready' | 'pending' | 'failed' | 'missing';",
    '    readonly metadata: unknown;',
    '    readonly errorCode: string | null;',
    '  }',
    '',
    '  interface SerpentAutomationApi {',
    '    readonly library: {',
    '      inspect(): Promise<SerpentScriptLibrary>;',
    '      changeSequence(): Promise<{ readonly changeSequence: number }>;',
    '      create(input: { displayName: string; selectedParentPath: string; idempotencyKey?: string }): Promise<{ readonly libraryId: string; readonly displayName: string }>;',
    '    };',
    '    readonly files: {',
    `      import(input: { sourceKind: 'files' | 'folder'; sourcePaths: readonly string[]; targetFolderId?: string; imageSequenceFps?: number; expandImageSequences?: boolean; idempotencyKey?: string }): Promise<SerpentScriptImportResult>;`,
    '    };',
    '    readonly folders: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<SerpentScriptFolderPage>;',
    '      create(name: string, parentFolderId?: string | null): Promise<SerpentScriptFolder>;',
    '    };',
    '    readonly linkedFolders: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<{',
    '        readonly items: readonly SerpentScriptLinkedFolder[];',
    '        readonly total: number; readonly offset: number; readonly limit: number; readonly hasMore: boolean;',
    '      }>;',
    '    };',
    '    readonly tags: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<SerpentScriptTagPage>;',
    '      create(name: string): Promise<SerpentScriptTag>;',
    '      assign(assetIds: readonly string[], tagIds: readonly string[]): Promise<SerpentTagMutationResult>;',
    '      remove(assetIds: readonly string[], tagIds: readonly string[]): Promise<SerpentTagMutationResult>;',
    '    };',
    '    readonly collections: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<{',
    '        readonly items: readonly SerpentScriptCollection[];',
    '        readonly total: number; readonly offset: number; readonly limit: number; readonly hasMore: boolean;',
    '      }>;',
    '      getMemberships(assetIds: readonly string[], input?: { limit?: number; offset?: number }): Promise<{',
    '        readonly items: readonly { readonly assetId: string; readonly collectionId: string }[];',
    '        readonly total: number; readonly offset: number; readonly limit: number; readonly hasMore: boolean;',
    '      }>;',
    '      create(name: string, parentId?: string | null): Promise<{ readonly id: string; readonly parentId: string | null; readonly name: string; readonly assetCount: number }>;',
    '      addAssets(collectionId: string, assetIds: readonly string[]): Promise<{ readonly collectionId: string }>;',
    '      removeAssets(collectionId: string, assetIds: readonly string[]): Promise<{ readonly collectionId: string }>;',
    '    };',
    '    readonly smartCollections: {',
    '      list(input?: { limit?: number; offset?: number }): Promise<{',
    '        readonly items: readonly SerpentScriptSmartCollection[];',
    '        readonly total: number; readonly offset: number; readonly limit: number; readonly hasMore: boolean;',
    '      }>;',
    '    };',
    '    readonly jobs: {',
    '      readonly media: {',
    '        list(input?: { limit?: number; offset?: number }): Promise<unknown>;',
    '      };',
    '      readonly ai: {',
    '        status(input?: { jobIds?: readonly string[]; limit?: number; offset?: number }): Promise<unknown>;',
    '        enqueue(input?: { assetIds?: readonly string[]; folderId?: string; resumePaused?: boolean }): Promise<{ readonly enqueued: number; readonly jobIds: readonly string[]; readonly alreadyPendingJobIds: readonly string[]; readonly skippedAssetIds: readonly string[] }>;',
    '      };',
    '    };',
    '    readonly assets: {',
    '      search(input: { query: string | null; limit?: number; offset?: number }): Promise<SerpentScriptAssetSearchPage>;',
    '      list(input?: { folderId?: string; recursive?: boolean; limit?: number; offset?: number }): Promise<SerpentScriptAssetSearchPage>;',
    '      getMetadata(assetId: string): Promise<SerpentScriptAssetMetadata>;',
    '      getAiContent(assetId: string): Promise<SerpentAiContent>;',
    '      setMetadata(input: { assetId: string; expectedVersion: number; description?: string | null; rating?: 0 | 1 | 2 | 3 | 4 | 5; favorite?: boolean; sourcePageUrl?: string | null; author?: string | null }): Promise<SerpentScriptAssetMetadata>;',
    '      getExtractedMetadata(assetId: string): Promise<SerpentScriptExtractedMetadata>;',
    '      setRating(assetIds: readonly string[], rating: 0 | 1 | 2 | 3 | 4 | 5): Promise<SerpentRatingUpdateResult>;',
    '      copyFilePaths(assetIds: readonly string[]): Promise<{ readonly copiedCount: number }>;',
    '      moveToTrash(assetIds: readonly string[]): Promise<{ readonly trashedCount: number; readonly operationId: string }>;',
    '      readContent(assetId: string, options?: { readonly maxBytes?: number }): Promise<{ readonly assetId: string; readonly revisionId: string; readonly byteSize: number; readonly dataBase64: string; readonly truncated: boolean; readonly mimeType: string | null }>;',
    '      replaceContent(assetId: string, dataBase64: string, options?: { readonly expectedRevisionId?: string; readonly mimeHint?: string }): Promise<{ readonly assetId: string; readonly revisionId: string; readonly byteSize: number }>;',
    '      stageContent(assetId: string, dataBase64: string, options?: { readonly stagingToken?: string; readonly complete?: boolean }): Promise<{ readonly assetId: string; readonly stagingToken: string; readonly byteSize: number; readonly complete: boolean }>;',
    '      replaceContentBatch(items: readonly ({ readonly assetId: string; readonly dataBase64: string; readonly expectedRevisionId: string } | { readonly assetId: string; readonly stagingToken: string; readonly expectedRevisionId: string })[]): Promise<{ readonly operationId: string; readonly items: readonly { readonly assetId: string; readonly revisionId: string; readonly byteSize: number }[] }>;',
    "      moveToFolder(assetIds: readonly string[], targetFolderId: string | null, options?: { readonly conflictStrategy?: 'keep-both' | 'replace' | 'skip' }): Promise<{ readonly movedCount: number; readonly skippedCount: number; readonly operationId: string | null }>;",
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
    '    readonly ui: {',
    "      notify(input: { severity: 'info' | 'warning' | 'error'; message: string; mode?: 'toast' | 'dialog'; title?: string }): Promise<{ readonly shown: true; readonly mode: 'toast' | 'dialog'; readonly severity: 'info' | 'warning' | 'error' }>;",
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
