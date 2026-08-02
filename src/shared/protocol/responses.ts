import { z } from 'zod';

import { aiSearchPlanSchema, assetMetadataResultSchema, extractedMetadataResultSchema, assetSummarySchema, collectionSummarySchema, folderBrowseEntrySchema, ignoredPathSchema, linkedFolderRuleSchema, linkedFolderSummarySchema, managedFolderSummarySchema, portableRelativePathSchema, smartCollectionSummarySchema, tagCooccurrenceGraphSchema, tagSummarySchema, trashedFolderSummarySchema } from '../asset-types';
import { pluginJobRecordSchema } from '../../plugins/plugin-jobs';
import { recentLibraryListSchema } from '../recent-libraries';
import { publicErrorReasonSchema, publicErrorSchema } from './errors';
import { CONTENT_REPLACE_MAX_BASE64_LENGTH } from '../content-replace';
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
  libraryDuplicateCount: z.number().int().nonnegative(),
  nameConflictCount: z.number().int().nonnegative(),
  examples: z.array(
    z.strictObject({
      displayName: safeDisplayName,
      kind: z.enum(['suspected-duplicate', 'library-duplicate', 'name-conflict']),
    }),
  ).max(8),
});

export type ImportConflictPlan = z.infer<typeof importConflictPlanSchema>;

export const automationImportPlanSchema = z.strictObject({
  libraryId: nonBlankString,
  planHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  changeSequence: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  suspectedDuplicateCount: z.number().int().nonnegative(),
  libraryDuplicateCount: z.number().int().nonnegative(),
  nameConflictCount: z.number().int().nonnegative(),
  sourceStates: z.array(z.strictObject({
    sourcePath: nonBlankString,
    stateToken: z.string().regex(/^[a-f0-9]{64}$/u),
  })).max(1_000),
});

export type AutomationImportPlan = z.infer<typeof automationImportPlanSchema>;

export const importCompletionSchema = z.strictObject({
  importedCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  replacedCount: z.number().int().nonnegative(),
  assets: z.array(assetSummarySchema),
});

export type ImportCompletion = z.infer<typeof importCompletionSchema>;

export const imageSequenceImportCandidateSchema = z.strictObject({
  displayName: safeDisplayName,
  extension: nonBlankString.max(16),
  firstFrame: z.number().int().nonnegative(),
  /** Absolute paths — Worker/Main only; stripped before Renderer. */
  framePaths: z.array(nonBlankString).max(100_000).optional(),
  frameCount: z.number().int().min(3).max(100_000),
  height: z.number().int().positive().nullable(),
  lastFrame: z.number().int().nonnegative(),
  numberStyle: z.enum(['trailing', 'parens']),
  numericWidth: z.number().int().nonnegative(),
  prefix: z.string().max(1024),
  width: z.number().int().positive().nullable(),
});

export type ImageSequenceImportCandidate = z.infer<
  typeof imageSequenceImportCandidateSchema
>;

export const imageSequenceImportOfferSchema = z.strictObject({
  defaultFps: z.number().int().min(1).max(240),
  libraryId: nonBlankString,
  /** Opaque Main-side handle; Renderer confirms with this id, not paths. */
  offerId: nonBlankString.optional(),
  selectedPaths: z.array(nonBlankString).min(1).max(1_000).optional(),
  sequences: z.array(imageSequenceImportCandidateSchema).max(64),
  targetCollectionId: nonBlankString.optional(),
  targetFolderId: nonBlankString.optional(),
});

export type ImageSequenceImportOffer = z.infer<
  typeof imageSequenceImportOfferSchema
>;

export const exportProgressEventSchema = z.strictObject({
  type: z.literal('export.progress'),
  exportId: nonBlankString,
  libraryId: nonBlankString,
  phase: z.enum(['snapshot-db', 'enumerate', 'copy', 'compress', 'complete', 'failed', 'cancelled']),
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
  phase: z.enum(['validate', 'copy', 'extract', 'verify', 'open', 'complete', 'failed', 'cancelled']),
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
  /**
   * `watcher` = external disk reconciliation (only this shows the disk-sync toast).
   * `text-save` / `client` / `content-replace` = in-app mutations; UI should use
   * operation-specific copy or silent canvas refresh.
   */
  source: z.enum(['watcher', 'text-save', 'client', 'content-replace']).optional(),
});

export type AssetChangeEvent = z.infer<typeof assetChangeEventSchema>;

export function parseAssetChangeEvent(input: unknown): AssetChangeEvent {
  return assetChangeEventSchema.parse(input);
}

export const libraryChangedEventSchema = z.strictObject({
  type: z.literal('library.changed'),
  libraryId: nonBlankString,
  changeSequence: z.number().int().nonnegative(),
});

export type LibraryChangedEvent = z.infer<typeof libraryChangedEventSchema>;

export function parseLibraryChangedEvent(input: unknown): LibraryChangedEvent {
  return libraryChangedEventSchema.parse(input);
}

export const extensionSaveCompletedEventSchema = z.strictObject({
  type: z.literal('extension.save.completed'),
  libraryId: nonBlankString,
  asset: assetSummarySchema,
});

export type ExtensionSaveCompletedEvent = z.infer<
  typeof extensionSaveCompletedEventSchema
>;

export function parseExtensionSaveCompletedEvent(
  input: unknown,
): ExtensionSaveCompletedEvent {
  return extensionSaveCompletedEventSchema.parse(input);
}

export const thumbnailEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('asset.thumbnail.ready'),
    libraryId: nonBlankString,
    assetId: nonBlankString,
    artifactId: nonBlankString,
  }),
  z.strictObject({
    type: z.literal('asset.thumbnail.failed'),
    libraryId: nonBlankString,
    assetId: nonBlankString,
    errorCode: nonBlankString,
    reason: nonBlankString,
  }),
]);

export type ThumbnailEvent = z.infer<typeof thumbnailEventSchema>;

export function parseThumbnailEvent(input: unknown): ThumbnailEvent {
  return thumbnailEventSchema.parse(input);
}

export const aiProgressEventSchema = z.strictObject({
  type: z.literal('ai.progress'),
  libraryId: nonBlankString,
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});

export type AiProgressEvent = z.infer<typeof aiProgressEventSchema>;

export function parseAiProgressEvent(input: unknown): AiProgressEvent {
  return aiProgressEventSchema.parse(input);
}

export const aiAnalysisCompletedEventSchema = z.strictObject({
  type: z.literal('ai.analysis.completed'),
  libraryId: nonBlankString,
  assetId: nonBlankString,
  fieldCount: z.number().int().nonnegative(),
  tagCount: z.number().int().nonnegative(),
});

export type AiAnalysisCompletedEvent = z.infer<typeof aiAnalysisCompletedEventSchema>;

export function parseAiAnalysisCompletedEvent(input: unknown): AiAnalysisCompletedEvent {
  return aiAnalysisCompletedEventSchema.parse(input);
}

export const aiContentClearedEventSchema = z.strictObject({
  type: z.literal('ai.content.cleared'),
  libraryId: nonBlankString,
  affectedAssetCount: z.number().int().nonnegative(),
  // Serpent-c9r3: IDs whose AI layer was cleared, so the renderer can refresh
  // the Inspector when the selected asset is among them (count alone is not
  // enough to know whether the current selection was affected).
  affectedAssetIds: z.array(nonBlankString),
});

export type AiContentClearedEvent = z.infer<typeof aiContentClearedEventSchema>;

export function parseAiContentClearedEvent(input: unknown): AiContentClearedEvent {
  return aiContentClearedEventSchema.parse(input);
}

export const mediaJobSchema = z.strictObject({
  jobId: nonBlankString,
  assetId: nonBlankString,
  revisionId: nonBlankString.nullable(),
  kind: z.enum([
    'generate_thumbnail',
    'generate_video_poster',
    'generate_contact_sheet',
    'generate_webm_proxy',
    'generate_audio_proxy',
    'extract_palette',
  ]),
  status: z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled']),
  progress: z.number().min(0).max(1),
  attemptCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  createdAt: nonBlankString,
  updatedAt: nonBlankString,
});

export type MediaJob = z.infer<typeof mediaJobSchema>;

export const aiJobSchema = z.strictObject({
  jobId: nonBlankString,
  assetId: nonBlankString,
  kind: z.enum(['ai.image.analysis', 'ai.video.analysis']),
  status: z.enum(['queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled']),
  errorCode: z.string().nullable(),
  errorDetail: z.string().nullable(),
  updatedAt: nonBlankString,
});

export type AiJob = z.infer<typeof aiJobSchema>;

const mediaJobCountsShape = {
  queued: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  paused: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
};

export const tagOperationSkipReasonSchema = z.enum(['asset_not_found']);

export type TagOperationSkipReason = z.infer<typeof tagOperationSkipReasonSchema>;

export const tagOperationSkipSchema = z.strictObject({
  assetId: nonBlankString,
  reason: tagOperationSkipReasonSchema,
});

export type TagOperationSkip = z.infer<typeof tagOperationSkipSchema>;

const assetOperationSuccessSchemas = [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.listed'),
    libraryId: nonBlankString,
    ...mediaJobCountsShape,
    jobs: z.array(mediaJobSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.paused'),
    libraryId: nonBlankString,
    pausedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.resumed'),
    libraryId: nonBlankString,
    resumedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.cancelled'),
    libraryId: nonBlankString,
    cancelledCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.retried'),
    libraryId: nonBlankString,
    retriedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.enqueued'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.listed'),
    libraryId: nonBlankString,
    jobs: z.array(pluginJobRecordSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.claimed'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.completed'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.cancelled'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.job-paused'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.resumed'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.retried'),
    libraryId: nonBlankString,
    job: pluginJobRecordSchema.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.jobs.paused'),
    libraryId: nonBlankString,
    pausedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.derived-fields.materialized'),
    libraryId: nonBlankString,
    writtenCount: z.number().int().nonnegative(),
    fieldKey: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('plugin.derived-fields.queried'),
    libraryId: nonBlankString,
    assetIds: z.array(nonBlankString),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.created'),
    folder: managedFolderSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.renamed'),
    folder: managedFolderSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.cloned'),
    folder: managedFolderSummarySchema,
    clonedFolderCount: z.number().int().nonnegative(),
    clonedAssetCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.moved'),
    movedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    folders: z.array(managedFolderSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.list'),
    folders: z.array(managedFolderSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.browse-entries'),
    entries: z.array(folderBrowseEntrySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.list-trashed'),
    folders: z.array(trashedFolderSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.restored-trashed'),
    restoredFolderCount: z.number().int().nonnegative(),
    restoredAssetCount: z.number().int().nonnegative(),
    folders: z.array(managedFolderSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.trashed'),
    folderId: nonBlankString,
    trashedAssetCount: z.number().int().nonnegative(),
    removedFolderCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.deleted-from-disk'),
    folderId: nonBlankString,
    deletedAssetCount: z.number().int().nonnegative(),
    removedFolderCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.removed'),
    folderId: nonBlankString,
    removedAssetCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.subtree-deleted'),
    linkedFolderId: nonBlankString,
    relativePath: nonBlankString,
    deletedAssetCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.list'),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.sequence.created'),
    asset: assetSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.sequence.dissolved'),
    sequenceId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.sequence.fps-updated'),
    sequenceId: nonBlankString,
    fps: z.number().min(1).max(240),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import.conflicts'),
    plan: importConflictPlanSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import.sequence-offer'),
    offer: imageSequenceImportOfferSchema,
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
    type: z.literal('linked-folder.rules'),
    rules: z.array(linkedFolderRuleSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.rules.updated'),
    rules: z.array(linkedFolderRuleSchema),
    hiddenCount: z.number().int().nonnegative(),
    restoredCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ignore.list'),
    paths: z.array(ignoredPathSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ignore.gitignore'),
    content: z.string(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ignore.gitignore.updated'),
    content: z.string(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ignore.updated'),
    ignored: z.boolean(),
    path: ignoredPathSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.assets.copied'),
    copiedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.converted'),
    managedFolderId: nonBlankString,
    convertedCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
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
    type: z.literal('tag.deleted-many'),
    deletedTagIds: z.array(nonBlankString),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.merged'),
    tag: tagSummarySchema,
    mergedTagIds: z.array(nonBlankString),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.cooccurrence'),
    graph: tagCooccurrenceGraphSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.assigned'),
    assignedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.removed'),
    removedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
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
    type: z.literal('collection.reordered'),
    orderedCollectionIds: z.array(nonBlankString),
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
    type: z.literal('collection.assets.memberships'),
    memberships: z.array(
      z.strictObject({
        assetId: nonBlankString,
        collectionId: nonBlankString,
      }),
    ),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.metadata.got'),
    metadata: assetMetadataResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.extracted-metadata.got'),
    result: extractedMetadataResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.color-space.updated'),
    assetId: nonBlankString,
    colorSpaceOverride: nonBlankString.nullable(),
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
    // Batch rating result; skips reuse the tag batch operation shape so the
    // renderer can share the same reason-code wording (REQ-MENU-007).
    ok: z.literal(true),
    type: z.literal('asset.rating.updated'),
    updatedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.list'),
    collections: z.array(smartCollectionSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.created'),
    collection: smartCollectionSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.updated'),
    collection: smartCollectionSummarySchema,
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
    operationId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.content.replaced'),
    assetId: nonBlankString,
    revisionId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.content.staged'),
    assetId: nonBlankString,
    stagingToken: nonBlankString,
    byteSize: z.number().int().nonnegative(),
    complete: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.content.batch-replaced'),
    operationId: nonBlankString,
    items: z.array(z.strictObject({
      assetId: nonBlankString,
      revisionId: nonBlankString,
      byteSize: z.number().int().nonnegative(),
    })).min(1),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.content.read'),
    assetId: nonBlankString,
    revisionId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
    dataBase64: z.string().max(CONTENT_REPLACE_MAX_BASE64_LENGTH),
    truncated: z.boolean(),
    mimeType: z.string().nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.restored'),
    restoredCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.restore-previewed'),
    hasNameConflicts: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.moved'),
    movedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    operationId: nonBlankString.nullable(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.move-undone'),
    undoneCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.trash-undone'),
    restoredCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.copied'),
    copiedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    operationId: nonBlankString.nullable(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.copy-undone'),
    undoneCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.file-renamed'),
    asset: assetSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.files-renamed'),
    renamedCount: z.number().int().nonnegative(),
    skipped: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: z.enum(['asset_not_found', 'asset_unavailable', 'name_conflict', 'invalid_name']),
    })),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.restored-if-original-vacant'),
    restoredCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    skipped: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: z.enum(['original_folder_missing', 'name_conflict', 'trash_file_missing']),
    })),
    assets: z.array(assetSummarySchema),
  }),
  z.strictObject({
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
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('automation.file-operation-planned'),
    libraryId: nonBlankString,
    operation: z.enum(['trash', 'replace-content', 'move', 'rename-file', 'rename-files', 'restore-if-original-vacant']),
    changeSequence: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
    executableCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    undoSupported: z.boolean(),
    assetStates: z.array(z.strictObject({
      assetId: nonBlankString,
      stateToken: z.string().regex(/^[a-f0-9]{64}$/u),
    })).min(1),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('automation.file-import-planned'),
    plan: automationImportPlanSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.text.read'),
    assetId: nonBlankString,
    revisionId: nonBlankString,
    content: z.string(),
    truncated: z.boolean(),
    byteSize: z.number().int().nonnegative(),
    lineCount: z.number().int().positive(),
    editable: z.boolean(),
    mimeType: z.string(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.text.saved'),
    asset: assetSummarySchema,
    revisionId: nonBlankString,
    byteSize: z.number().int().nonnegative(),
    lineCount: z.number().int().positive(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.deleted-permanent'),
    deletedCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
    skippedReasons: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: publicErrorReasonSchema,
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.deleted-from-disk'),
    deletedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.deleted-linked'),
    deletedCount: z.number().int().nonnegative(),
    failedCount: z.number().int().nonnegative(),
    failures: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: publicErrorReasonSchema,
    })),
  }).refine((result) => result.failedCount === result.failures.length, {
    message: 'failedCount must match failures length.',
    path: ['failedCount'],
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
    skippedCount: z.number().int().nonnegative(),
    failures: z.array(z.strictObject({
      assetId: nonBlankString,
      reason: publicErrorReasonSchema,
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.relinked'),
    asset: assetSummarySchema,
    batchFollowUpRoot: z.string().min(1),
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
      description: nonBlankString.optional(),
      tags: z.array(nonBlankString).optional(),
      rating: z.number().int().min(1).max(5).optional(),
    }),
    modelVersion: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.analyze-unsupported'),
    assetId: nonBlankString,
    reason: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.analyze-queued'),
    assetId: nonBlankString,
    enqueued: z.number().int().positive(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('assets.analyze-queued'),
    assetIds: z.array(nonBlankString).min(1),
    jobIds: z.array(nonBlankString).min(1),
    skippedAssetIds: z.array(nonBlankString),
    enqueued: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.thumbnail.generated'),
    assetId: nonBlankString,
    artifactId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.preview.resolved'),
    assetId: nonBlankString,
    mediaType: z.enum(['image', 'video', 'audio', 'text', 'other']),
    status: z.enum(['ready', 'pending', 'failed', 'missing']),
    kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
    url: nonBlankString.optional(),
    posterUrl: nonBlankString.optional(),
    errorCode: nonBlankString.optional(),
    playbackMode: z.enum(['source', 'proxy']).optional(),
    sourceMimeType: nonBlankString.optional(),
    sourceContainer: z.enum(['mp4', 'mov', 'webm']).optional(),
    sourceCodecs: z.array(nonBlankString).optional(),
    playbackToken: nonBlankString.optional(),
    exrPlanes: z.array(z.strictObject({
      index: z.number().int().nonnegative(),
      label: nonBlankString,
    })).optional(),
    selectedExrPlane: z.number().int().nonnegative().optional(),
    colorSpace: z.strictObject({
      id: nonBlankString,
      label: nonBlankString,
      source: z.enum(['embedded', 'metadata', 'inferred']),
      isLinear: z.boolean(),
      metadataName: nonBlankString.optional(),
      options: z.array(z.strictObject({
        id: nonBlankString,
        label: nonBlankString,
        isLinear: z.boolean(),
      })),
    }).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.open-external.requested'),
    assetId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.open-with.requested'),
    assetId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.reveal-in-folder.requested'),
    assetId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.copy-file-path.requested'),
    assetId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.copy-files.requested'),
    assetIds: z.array(nonBlankString).min(1),
  }),
  // Folder shell-action acknowledgements carry only the folder id; the
  // absolute path stays on the Worker→Main boundary (REQ-COMMAND-003).
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.open-in-file-manager.requested'),
    folderId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.open-with.requested'),
    folderId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.copy-path.requested'),
    folderId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.copy.requested'),
    folderId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.preview.closed'),
    assetId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.preview-error.recorded'),
    assetId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.retry-artifact.started'),
    assetId: nonBlankString,
    kind: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.content.cleared'),
    libraryId: nonBlankString,
    clearedCount: z.number().int().nonnegative(),
    affectedAssetIds: z.array(nonBlankString),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.paused'),
    libraryId: nonBlankString,
    pausedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.resumed'),
    libraryId: nonBlankString,
    resumedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.cancelled'),
    libraryId: nonBlankString,
    cancelledCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.retried'),
    libraryId: nonBlankString,
    retriedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.status'),
    libraryId: nonBlankString,
    ...mediaJobCountsShape,
    jobs: z.array(aiJobSchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.config.saved'),
  }),
] as const;

const workerSuccessResultSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.relink-batch.preview'),
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    examples: z.array(z.strictObject({
      relativeFilePath: portableRelativePathSchema,
      matched: z.boolean(),
    })).max(8),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.list'),
    libraries: z.array(internalLibrarySummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.change-sequence'),
    libraryId: nonBlankString,
    changeSequence: z.number().int().nonnegative(),
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
    type: z.literal('library.renamed'),
    library: internalLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.deleted'),
    libraryId: nonBlankString,
    displayName: nonBlankString,
    libraryPath: nonBlankString,
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
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.thumbnail.generated'),
    assetId: nonBlankString,
    artifactId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.retry-artifact.queued'),
    assetId: nonBlankString,
    kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.artifact-path'),
    artifactId: nonBlankString,
    absolutePath: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.source-path'),
    assetId: nonBlankString,
    revisionId: nonBlankString,
    absolutePath: nonBlankString,
    mimeType: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.thumbnail-artifact'),
    artifactId: nonBlankString,
    filePath: nonBlankString,
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.preview-artifact'),
    assetId: nonBlankString,
    mediaType: z.enum(['image', 'video', 'audio', 'text', 'other']),
    status: z.enum(['ready', 'pending', 'failed', 'missing']),
    kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
    artifactId: nonBlankString.optional(),
    posterArtifactId: nonBlankString.optional(),
    mimeType: nonBlankString,
    errorCode: nonBlankString.optional(),
    playbackMode: z.enum(['source', 'proxy']).optional(),
    sourceRevisionId: nonBlankString.optional(),
    sourceMimeType: nonBlankString.optional(),
    sourceContainer: z.enum(['mp4', 'mov', 'webm']).optional(),
    sourceCodecs: z.array(nonBlankString).optional(),
    exrPlanes: z.array(z.strictObject({
      index: z.number().int().nonnegative(),
      label: nonBlankString,
    })).optional(),
    selectedExrPlane: z.number().int().nonnegative().optional(),
    colorSpace: z.strictObject({
      id: nonBlankString,
      label: nonBlankString,
      source: z.enum(['embedded', 'metadata', 'inferred']),
      isLinear: z.boolean(),
      metadataName: nonBlankString.optional(),
      options: z.array(z.strictObject({
        id: nonBlankString,
        label: nonBlankString,
        isLinear: z.boolean(),
      })),
    }).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.asset-path'),
    assetId: nonBlankString,
    absolutePath: nonBlankString,
  }),
  // Worker→Main only: absolute paths never enter the renderer result schema.
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.asset-paths'),
    assetIds: z.array(nonBlankString).min(1),
    absolutePaths: z.array(nonBlankString).min(1),
  }),
  // Worker→Main only: the resolved folder path never enters the renderer
  // result schema (REQ-COMMAND-003).
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.path'),
    folderId: nonBlankString,
    absolutePath: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.enqueued'),
    libraryId: nonBlankString,
    enqueued: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.enqueued'),
    libraryId: nonBlankString,
    enqueued: z.number().int().nonnegative(),
    jobIds: z.array(nonBlankString),
    alreadyPendingJobIds: z.array(nonBlankString),
    skippedAssetIds: z.array(nonBlankString),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.jobs.processed'),
    libraryId: nonBlankString,
    processed: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.jobs.processed'),
    libraryId: nonBlankString,
    processed: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    requeued: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.concurrency.updated'),
    concurrencyLimit: z.number().int().min(1).max(32),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.test-connection.result'),
    success: z.boolean(),
    errorKind: nonBlankString.optional(),
    reason: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.content.got'),
    assetId: nonBlankString,
    description: z.string().nullable(),
    tags: z.array(nonBlankString),
    rating: z.number().int().min(1).max(5).nullable(),
    modelVersion: nonBlankString.nullable(),
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
    type: z.literal('asset.relink-batch.preview'),
    previewId: nonBlankString,
    matchedCount: z.number().int().nonnegative(),
    unmatchedCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    examples: z.array(z.strictObject({
      relativeFilePath: portableRelativePathSchema,
      matched: z.boolean(),
    })).max(8),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.relink-batch.cancelled'),
    previewId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.list'),
    libraries: z.array(rendererLibrarySummarySchema),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.recent-list'),
    libraries: recentLibraryListSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.forgotten'),
    libraryPath: nonBlankString,
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
    type: z.literal('library.renamed'),
    library: rendererLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.deleted'),
    libraryId: nonBlankString,
    displayName: nonBlankString,
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
    apiFormat: z.enum(['dashscope_native', 'openai_chat', 'openai_responses', 'anthropic', 'gemini_native']).nullable(),
    model: nonBlankString.nullable(),
    /** Empty string means official default for the selected API format. */
    baseUrl: z.string().max(2048),
    hasKey: z.boolean(),
    enabledFields: z.strictObject({
      description: z.boolean(),
      tags: z.boolean(),
      rating: z.boolean(),
    }),
    analysisSettings: z.strictObject({
      forceExistingTags: z.boolean(),
      maxTags: z.number().int().min(1).max(32),
      maxDescriptionCharsZh: z.number().int().min(20).max(500),
      maxDescriptionWordsEn: z.number().int().min(10).max(200),
      outputStyle: z.enum(['normal', 'concise', 'rigorous']),
      ratingRubric: z.string().min(1).max(4_000),
      customDescriptionPrompt: z.string().max(4_000),
      customTagPrompt: z.string().max(4_000),
    }),
    languages: z.array(z.enum(['zh-CN', 'en', 'ja', 'ko'])).min(1).max(8),
    concurrencyLimit: z.number().int().min(1).max(32),
    maxAnalysisImageEdgePx: z.number().int().min(512).max(4096),
    reliabilitySettings: z.strictObject({
      requestTimeoutMs: z.number().int().min(15_000).max(600_000),
      maxAttempts: z.number().int().min(1).max(10),
      retryBaseDelayMs: z.number().int().min(100).max(60_000),
      retryMaxDelayMs: z.number().int().min(1_000).max(600_000),
      retryJitterRatio: z.number().min(0).max(0.5),
    }),
    autoAnalyzeEnabled: z.boolean(),
    disclaimerAccepted: z.boolean(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.content.got'),
    assetId: nonBlankString,
    description: z.string().nullable(),
    tags: z.array(nonBlankString),
    rating: z.number().int().min(1).max(5).nullable(),
    modelVersion: nonBlankString.nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.test-connection.result'),
    success: z.boolean(),
    errorKind: nonBlankString.optional(),
    reason: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.list-models.result'),
    models: z.array(nonBlankString),
    errorKind: nonBlankString.optional(),
    reason: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.search-plan.result'),
    plan: aiSearchPlanSchema,
    apiFormat: z.enum(['dashscope_native', 'openai_chat', 'openai_responses', 'anthropic', 'gemini_native']),
    model: nonBlankString,
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
