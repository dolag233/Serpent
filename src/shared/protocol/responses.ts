import { z } from 'zod';

import { assetMetadataResultSchema, assetSummarySchema, collectionSummarySchema, linkedFolderSummarySchema, managedFolderSummarySchema, smartCollectionSummarySchema, tagSummarySchema } from '../asset-types';
import { publicErrorSchema } from './errors';
import {
  WORKER_READY_MESSAGE_TYPE,
  WORKER_SHUTDOWN_ACK_MESSAGE_TYPE,
  WORKER_SHUTDOWN_MESSAGE_TYPE,
} from './channels';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});
const safeDisplayName = nonBlankString.max(255).refine(
  (value) => !value.includes('/') && !value.includes('\\'),
  { message: 'Display names must not contain filesystem paths.' },
);

export const workerReadyMessageSchema = z.strictObject({
  type: z.literal(WORKER_READY_MESSAGE_TYPE),
});

export type WorkerReadyMessage = z.infer<typeof workerReadyMessageSchema>;

export function parseWorkerReadyMessage(input: unknown): WorkerReadyMessage {
  return workerReadyMessageSchema.parse(input);
}

export const workerControlMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal(WORKER_SHUTDOWN_MESSAGE_TYPE) }),
  z.strictObject({ type: z.literal(WORKER_SHUTDOWN_ACK_MESSAGE_TYPE) }),
]);

export type WorkerControlMessage = z.infer<typeof workerControlMessageSchema>;

export function parseWorkerControlMessage(input: unknown): WorkerControlMessage {
  return workerControlMessageSchema.parse(input);
}

export const internalLibrarySummarySchema = z.strictObject({
  libraryId: nonBlankString,
  displayName: nonBlankString,
  libraryPath: nonBlankString,
});

export type InternalLibrarySummary = z.infer<typeof internalLibrarySummarySchema>;

export const rendererLibrarySummarySchema = z.strictObject({
  libraryId: nonBlankString,
  displayName: nonBlankString,
  displayPath: nonBlankString,
});

export type RendererLibrarySummary = z.infer<typeof rendererLibrarySummarySchema>;

export const importConflictPlanSchema = z.strictObject({
  importId: nonBlankString,
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  suspectedDuplicateCount: z.number().int().nonnegative(),
  nameConflictCount: z.number().int().nonnegative(),
  examples: z.array(
    z.strictObject({
      displayName: safeDisplayName,
      kind: z.enum(['suspected-duplicate', 'name-conflict']),
    }),
  ).max(8),
});

export type ImportConflictPlan = z.infer<typeof importConflictPlanSchema>;

export const importCompletionSchema = z.strictObject({
  importedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  replacedCount: z.number().int().nonnegative(),
  assets: z.array(assetSummarySchema),
});

export type ImportCompletion = z.infer<typeof importCompletionSchema>;

export const exportProgressEventSchema = z.strictObject({
  type: z.literal('export.progress'),
  exportId: nonBlankString,
  libraryId: nonBlankString,
  phase: z.enum(['snapshot-db', 'enumerate', 'copy', 'complete', 'failed', 'cancelled']),
  filesProcessed: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  bytesProcessed: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export type ExportProgressEvent = z.infer<typeof exportProgressEventSchema>;

export function parseExportProgressEvent(input: unknown): ExportProgressEvent {
  return exportProgressEventSchema.parse(input);
}

export const importProgressEventSchema = z.strictObject({
  type: z.literal('import.progress'),
  importId: nonBlankString,
  phase: z.enum(['validate', 'copy', 'open', 'complete', 'failed', 'cancelled']),
  filesProcessed: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  bytesProcessed: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export type ImportProgressEvent = z.infer<typeof importProgressEventSchema>;

export function parseImportProgressEvent(input: unknown): ImportProgressEvent {
  return importProgressEventSchema.parse(input);
}

export const progressEventSchema = z.union([
  exportProgressEventSchema,
  importProgressEventSchema,
]);

export type ProgressEvent = z.infer<typeof progressEventSchema>;

export function parseProgressEvent(input: unknown): ProgressEvent {
  return progressEventSchema.parse(input);
}

export const assetChangeEventSchema = z.strictObject({
  type: z.literal('asset.changed'),
  libraryId: nonBlankString,
  changedCount: z.number().int().positive(),
  missingCount: z.number().int().nonnegative(),
});

export type AssetChangeEvent = z.infer<typeof assetChangeEventSchema>;

export function parseAssetChangeEvent(input: unknown): AssetChangeEvent {
  return assetChangeEventSchema.parse(input);
}

const assetOperationSuccessSchemas = [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.created'),
    folder: managedFolderSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.list'),
    folders: z.array(managedFolderSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.list'),
    assets: z.array(assetSummarySchema),
  }),
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
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import.abandoned'),
    importId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.refreshed'),
    changedCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import-linked.completed'),
    linkedFolder: linkedFolderSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.list'),
    folders: z.array(linkedFolderSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.relinked'),
    linkedFolder: linkedFolderSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.list'),
    tags: z.array(tagSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.created'),
    tag: tagSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.renamed'),
    tag: tagSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.deleted'),
    tagId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.assigned'),
    assignedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.removed'),
    removedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.list'),
    collections: z.array(collectionSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.created'),
    collection: collectionSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.updated'),
    collection: collectionSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.deleted'),
    collectionId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.added'),
    collectionId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.removed'),
    collectionId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.reordered'),
    collectionId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.list'),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.metadata.got'),
    metadata: assetMetadataResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.metadata.updated'),
    metadata: assetMetadataResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.metadata.backfilled'),
    backfilledCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.list'),
    collections: z.array(smartCollectionSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.created'),
    collection: z.strictObject({
      collectionId: nonBlankString,
      name: nonBlankString,
      queryDefinition: nonBlankString,
      position: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.updated'),
    collection: z.strictObject({
      collectionId: nonBlankString,
      name: nonBlankString,
      queryDefinition: nonBlankString,
      position: z.number().int().nonnegative(),
    }),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.deleted'),
    collectionId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.executed'),
    items: z.array(assetSummarySchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.search.result'),
    items: z.array(assetSummarySchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    snippets: z.array(
      z.strictObject({
        assetId: nonBlankString,
        text: nonBlankString,
      }),
    ).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.trashed'),
    trashedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.restored'),
    restoredCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.deleted-permanent'),
    deletedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    skippedReasons: z.array(nonBlankString),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.deleted-linked'),
    deletedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.list-trash'),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.purge-trash'),
    purgedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.relinked'),
    asset: assetSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.relink-batch.preview'),
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    examples: z.array(z.strictObject({
      relativeFilePath: nonBlankString,
      matched: z.boolean(),
    })).max(8),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.relink-batch.applied'),
    restoredCount: z.number().int().nonnegative(),
    unchangedMissingCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('extension.asset-saved'),
    asset: assetSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.analyzed'),
    assetId: nonBlankString,
    generatedFields: z.strictObject({
      label: nonBlankString.optional(),
      description: nonBlankString.optional(),
      tags: z.array(nonBlankString).optional(),
      structuredMetadata: z.record(z.string(), z.unknown()).optional(),
    }),
    modelVersion: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.analyze-unsupported'),
    assetId: nonBlankString,
    reason: nonBlankString,
  }),
] as const;

const workerSuccessResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.list'),
    libraries: z.array(internalLibrarySummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.opened'),
    library: internalLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
  }),
  z.strictObject({
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
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.imported'),
    importId: nonBlankString,
    libraryId: nonBlankString,
    displayName: nonBlankString,
    libraryPath: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.import-validated'),
    importId: nonBlankString,
    libraryId: nonBlankString,
    displayName: nonBlankString,
  }),
  ...assetOperationSuccessSchemas,
]);

export const workerResultSchema = z.union([
  workerSuccessResultSchema,
  z.strictObject({
    ok: z.literal(false),
    error: publicErrorSchema,
  }),
]);

export type WorkerResult = z.infer<typeof workerResultSchema>;

export const workerResponseSchema = z.strictObject({
  requestId: nonBlankString,
  result: workerResultSchema,
});

export type WorkerResponse = z.infer<typeof workerResponseSchema>;

export function parseWorkerResponse(input: unknown): WorkerResponse {
  return workerResponseSchema.parse(input);
}

const rendererSuccessResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.list'),
    libraries: z.array(rendererLibrarySummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.opened'),
    library: rendererLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.import-validated'),
    importId: nonBlankString,
    libraryId: nonBlankString,
    displayName: nonBlankString,
  }),
  z.strictObject({
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
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.imported'),
    importId: nonBlankString,
    libraryId: nonBlankString,
    displayName: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.config.got'),
    provider: z.enum(['openai', 'gemini', 'anthropic']).nullable(),
    model: nonBlankString.nullable(),
    hasKey: z.boolean(),
    enabledFields: z.strictObject({
      label: z.boolean(),
      description: z.boolean(),
      tags: z.boolean(),
      structuredMetadata: z.boolean(),
    }),
    language: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.config.saved'),
  }),
  ...assetOperationSuccessSchemas,
]);

export const rendererResultSchema = z.union([
  rendererSuccessResultSchema,
  z.strictObject({
    ok: z.literal(false),
    error: publicErrorSchema,
  }),
]);

export type RendererResult = z.infer<typeof rendererResultSchema>;

export function parseRendererResult(input: unknown): RendererResult {
  return rendererResultSchema.parse(input);
}

export const rendererLifecycleEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('library.opening'),
    operation: z.enum(['create', 'open', 'import']),
  }),
  z.strictObject({
    type: z.literal('library.opened'),
    library: rendererLibrarySummarySchema,
  }),
  z.strictObject({
    type: z.literal('library.open-failed'),
    operation: z.enum(['create', 'open', 'import']),
    error: publicErrorSchema,
  }),
  z.strictObject({
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
  }),
]);

export type RendererLifecycleEvent = z.infer<typeof rendererLifecycleEventSchema>;

export function parseRendererLifecycleEvent(input: unknown): RendererLifecycleEvent {
  return rendererLifecycleEventSchema.parse(input);
}
