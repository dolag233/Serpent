import { z } from 'zod';

import { aiSearchPlanSchema, assetMetadataResultSchema, extractedMetadataResultSchema, assetSummarySchema, browseGeometryBlockSchema, browseLayoutEntrySchema, collectionSummarySchema, folderBrowseEntrySchema, ignoredPathSchema, linkedFolderDirectoryMutationSchema, linkedFolderRuleSchema, linkedFolderSummarySchema, managedFolderSummarySchema, portableRelativePathSchema, smartCollectionSummarySchema, tagCooccurrenceGraphSchema, tagSummarySchema, trashedFolderSummarySchema } from '../asset-types';
import { libraryNavigationSummarySchema } from '../library-navigation';
import { pluginJobRecordSchema } from '../../plugins/plugin-jobs';
import { recentLibraryListSchema } from '../recent-libraries';
import { publicErrorReasonSchema, publicErrorSchema } from './errors';
import { fbxConvertErrorCodeSchema, fbxConversionStatsSchema } from '../fbx-conversion';
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

// 'read-only' remains so older Worker events still parse. Desktop no longer
// opens a user library in that mode; damage goes to backup then Assets rescue.
const libraryRecoveryModeSchema = z.enum(['backup-1', 'backup-2', 'read-only', 'rescue']);
const recoveryMetadataLossSchema = z.enum([
  'collections',
  'tags',
  'ratings',
  'descriptions',
  'source-links',
]);

// Worker/Main may retain the report path for internal diagnostics, but an
// absolute filesystem path must never cross the renderer boundary.
const internalLibraryRecoverySchema = z.strictObject({
  mode: libraryRecoveryModeSchema,
  reportPath: nonBlankString.optional(),
  recoveredAssetCount: z.number().int().nonnegative().optional(),
  metadataRecovered: z.boolean().optional(),
  metadataLosses: z.array(recoveryMetadataLossSchema).optional(),
});

const rendererLibraryRecoverySchema = z.strictObject({
  mode: libraryRecoveryModeSchema,
  reportAvailable: z.boolean().optional(),
  recoveredAssetCount: z.number().int().nonnegative().optional(),
  metadataRecovered: z.boolean().optional(),
  metadataLosses: z.array(recoveryMetadataLossSchema).optional(),
});

/** Serpent-xffq: WebDAV 能力探测结果（probe/preview/run 的 report 内均带）。 */
const syncCapabilitiesSchema = z.strictObject({
  auth: z.enum(['none', 'basic', 'digest']),
  supportsContentTransfer: z.boolean(),
  supportsDepthInfinity: z.boolean(),
  supportsEtagIfMatch: z.boolean(),
  supportsMove: z.boolean(),
  supportsLock: z.boolean(),
  quotaBytes: z.number().optional(),
  usedBytes: z.number().optional(),
  maxUploadBytes: z.number().optional(),
});

export const missingAssetRecoveryProbeSchema = z.strictObject({
  status: z.enum(['recoverable', 'needs-location', 'not-missing']),
  candidateKind: z.enum(['managed-source', 'trash', 'linked-source']).nullable(),
  contentVerified: z.boolean(),
  checkedLocations: z.number().int().nonnegative(),
});

export type MissingAssetRecoveryProbe = z.infer<typeof missingAssetRecoveryProbeSchema>;

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
  // Serpent-033e: the library was written by a newer Serpent build than the
  // running one. Desktop still opens it writable (additive schema; extra
  // columns/rows are ignored). libraryVersion/supportedSchemaVersion remain
  // for diagnostics. Inspection-only handles may still set readOnly.
  readOnly: z.boolean().optional(),
  // True when the library root is on a confirmed NAS/SMB/NFS volume. The
  // Worker uses rollback journaling there and the Desktop shows the
  // experimental-storage warning; absence means local or undetected.
  networkStorage: z.boolean().optional(),
  libraryVersion: z.number().int().positive().optional(),
  supportedSchemaVersion: z.number().int().positive().optional(),
  // True when a migration failed repeatedly and this build skipped further
  // retries, opening writable at the last good schema version instead.
  migrationStuck: z.boolean().optional(),
  /** Set when the open path recovered or rebuilt a damaged database. */
  recovery: internalLibraryRecoverySchema.optional(),
});

export type InternalLibrarySummary = z.infer<typeof internalLibrarySummarySchema>;

export const rendererLibrarySummarySchema = z.strictObject({
  libraryId: nonBlankString,
  displayName: nonBlankString,
  displayPath: nonBlankString,
  readOnly: z.boolean().optional(),
  networkStorage: z.boolean().optional(),
  libraryVersion: z.number().int().positive().optional(),
  supportedSchemaVersion: z.number().int().positive().optional(),
  // True when a migration failed repeatedly and this build skipped further
  // retries, opening writable at the last good schema version instead.
  migrationStuck: z.boolean().optional(),
  /** Set when the open path recovered or rebuilt a damaged database. */
  recovery: rendererLibraryRecoverySchema.optional(),
});

export type RendererLibrarySummary = z.infer<typeof rendererLibrarySummarySchema>;

export const historyEntrySummarySchema = z.strictObject({
  historyEntryId: nonBlankString,
  source: z.enum(['desktop', 'script', 'mcp', 'plugin']),
  sourceReference: nonBlankString.nullable(),
  labelKey: nonBlankString,
  labelArgs: z.record(z.string(), z.union([z.string(), z.number()])),
  policy: z.enum(['reversible', 'barrier']),
  state: z.enum(['open', 'applied', 'undoing', 'undone', 'redoing', 'stale']),
  staleCode: nonBlankString.nullable(),
  affectedCount: z.number().int().nonnegative(),
});

export type HistoryEntrySummary = z.infer<typeof historyEntrySummarySchema>;

export const historyStatusSchema = z.strictObject({
  libraryId: nonBlankString,
  undoTop: historyEntrySummarySchema.nullable(),
  redoTop: historyEntrySummarySchema.nullable(),
  staleTop: historyEntrySummarySchema.nullable(),
  transitionInProgress: z.boolean(),
});

export type HistoryStatus = z.infer<typeof historyStatusSchema>;

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
      /** Library asset that already holds matching content (content-duplicate). */
      existingDisplayName: safeDisplayName.optional(),
      existingAssetId: nonBlankString.optional(),
      existingThumbnailArtifactId: nonBlankString.optional(),
    }),
  ).max(8),
});

export type ImportConflictPlan = z.infer<typeof importConflictPlanSchema>;

export const automationImportPlanSchema = z.strictObject({
  libraryId: nonBlankString,
  planHash: z.string().regex(/^[a-f0-9]{64}$/u),
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

export const eagleImportResultSchema = z.strictObject({
  sourceDisplayName: safeDisplayName,
  importedCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  replacedCount: z.number().int().nonnegative(),
  collectionCount: z.number().int().nonnegative(),
  tagCount: z.number().int().nonnegative(),
  invalidItemCount: z.number().int().nonnegative(),
  // Large Eagle libraries must not send tens of thousands of cards through
  // Main/Preload. The UI reloads its current scope after the operation.
  assets: z.array(assetSummarySchema).max(300),
});

export type EagleImportResult = z.infer<typeof eagleImportResultSchema>;

/** Result of importing a Billfish library folder into the current library. */
export const billfishImportResultSchema = z.strictObject({
  sourceDisplayName: safeDisplayName,
  importedCount: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  assetCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  replacedCount: z.number().int().nonnegative(),
  collectionCount: z.number().int().nonnegative(),
  tagCount: z.number().int().nonnegative(),
  invalidItemCount: z.number().int().nonnegative(),
  metadataCount: z.number().int().nonnegative(),
  assets: z.array(assetSummarySchema).max(300),
});

export type BillfishImportResult = z.infer<typeof billfishImportResultSchema>;

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
  /** True when the import can be cancelled between batches. */
  cancelable: z.boolean().optional(),
  filesProcessed: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  bytesProcessed: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
});

export type ImportProgressEvent = z.infer<typeof importProgressEventSchema>;

export function parseImportProgressEvent(input: unknown): ImportProgressEvent {
  return importProgressEventSchema.parse(input);
}

/**
 * 同步传输进度（Serpent-xffq 增量）：done/total 为文件动作数，
 * bytesDone/bytesTotal 为已传输与总字节（含上传与下载），供 UI
 * 显示进度条与传输速度。phase=run 为执行中；preview 为差异计算阶段；
 * complete 表示本次同步已结束（UI 据此收起进度条）。
 */
export const syncProgressEventSchema = z.strictObject({
  type: z.literal('sync.progress'),
  libraryId: nonBlankString,
  phase: z.enum(['preview', 'run', 'complete']),
  filesDone: z.number().int().nonnegative(),
  filesTotal: z.number().int().nonnegative(),
  bytesDone: z.number().int().nonnegative(),
  bytesTotal: z.number().int().nonnegative(),
});

export type SyncProgressEvent = z.infer<typeof syncProgressEventSchema>;

export function parseSyncProgressEvent(input: unknown): SyncProgressEvent {
  return syncProgressEventSchema.parse(input);
}

export const progressEventSchema = z.union([
  exportProgressEventSchema,
  importProgressEventSchema,
  syncProgressEventSchema,
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
    // Video dimensions are learned by the metadata job before the poster is
    // published. Carry them with the event so a browse grid can reflow the
    // card immediately instead of keeping the initial square fallback.
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.thumbnail.failed'),
    libraryId: nonBlankString,
    assetId: nonBlankString,
    errorCode: nonBlankString,
    reason: nonBlankString,
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.dimensions.ready'),
    libraryId: nonBlankString,
    assetId: nonBlankString,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    durationMs: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    type: z.literal('asset.derived.ready'),
    libraryId: nonBlankString,
    assetId: nonBlankString,
    kind: z.enum([
      'extract_metadata',
      'extract_palette',
      'generate_contact_sheet',
      'generate_webm_proxy',
      'generate_audio_proxy',
    ]),
  }),
]);

export type ThumbnailEvent = z.infer<typeof thumbnailEventSchema>;

export function parseThumbnailEvent(input: unknown): ThumbnailEvent {
  return thumbnailEventSchema.parse(input);
}

/** Internal Worker→Main signal: the contact sheet required for video AI exists. */
export const aiInputReadyEventSchema = z.strictObject({
  type: z.literal('asset.ai-input.ready'),
  libraryId: nonBlankString,
  assetId: nonBlankString,
  artifactId: nonBlankString,
});

export type AiInputReadyEvent = z.infer<typeof aiInputReadyEventSchema>;

export function parseAiInputReadyEvent(input: unknown): AiInputReadyEvent {
  return aiInputReadyEventSchema.parse(input);
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
  /** Basename only; absolute and library-relative paths never cross the bridge. */
  assetName: nonBlankString.nullable().optional(),
  revisionId: nonBlankString.nullable(),
  kind: z.enum([
    'generate_thumbnail',
    'generate_video_poster',
    'extract_metadata',
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
  /** Basename only; absolute and library-relative paths never cross the bridge. */
  assetName: nonBlankString.nullable().optional(),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.renamed'),
    folder: managedFolderSummarySchema,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.directory-created'),
    folder: linkedFolderDirectoryMutationSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('linked-folder.directory-renamed'),
    folder: linkedFolderDirectoryMutationSchema,
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
    historyEntryId: nonBlankString.optional(),
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
    type: z.literal('folder.entries'),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('folder.trashed'),
    folderId: nonBlankString,
    trashedAssetCount: z.number().int().nonnegative(),
    removedFolderCount: z.number().int().nonnegative(),
    tombstoneIds: z.array(nonBlankString).optional(),
    historyEntryId: nonBlankString.optional(),
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
    type: z.literal('folder.empty-deleted'),
    deletedFolderIds: z.array(nonBlankString),
    historyEntryId: nonBlankString.optional(),
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
    relativePath: z.union([z.literal(''), portableRelativePathSchema]),
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
    type: z.literal('asset.sequence.dissolved-batch'),
    sequenceIds: z.array(nonBlankString).min(1),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.renamed'),
    tag: tagSummarySchema,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.deleted'),
    tagId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.deleted-many'),
    deletedTagIds: z.array(nonBlankString),
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.merged'),
    tag: tagSummarySchema,
    mergedTagIds: z.array(nonBlankString),
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('tag.removed'),
    removedCount: z.number().int().nonnegative(),
    skipped: z.array(tagOperationSkipSchema),
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.updated'),
    collection: collectionSummarySchema,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.reordered'),
    orderedCollectionIds: z.array(nonBlankString),
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.deleted'),
    collectionId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.added'),
    collectionId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.removed'),
    collectionId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('collection.assets.reordered'),
    collectionId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.metadata.updated-many'),
    metadata: z.array(assetMetadataResultSchema).min(1),
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.updated'),
    collection: smartCollectionSummarySchema,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.deleted'),
    collectionId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('smart-collection.executed'),
    items: z.array(assetSummarySchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    /** Serpent-ws4k: present when the request used idsOnly (select-all). */
    assetIds: z.array(nonBlankString).optional(),
    layout: z.array(browseLayoutEntrySchema).optional(),
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
    /** Serpent-ws4k: present when the request used idsOnly (select-all). */
    assetIds: z.array(nonBlankString).optional(),
    layout: z.array(browseLayoutEntrySchema).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('browse.session.opened'),
    sessionId: nonBlankString,
    libraryGeneration: z.number().int().nonnegative(),
    changeSequence: z.number().int().nonnegative(),
    queryFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    items: z.array(assetSummarySchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    snippets: z.array(z.strictObject({
      assetId: nonBlankString,
      text: z.string().max(4_000),
    })).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('browse.session.page'),
    sessionId: nonBlankString,
    changeSequence: z.number().int().nonnegative(),
    items: z.array(assetSummarySchema),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    snippets: z.array(z.strictObject({
      assetId: nonBlankString,
      text: z.string().max(4_000),
    })).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('browse.session.geometry'),
    libraryId: nonBlankString,
    ...browseGeometryBlockSchema.shape,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('browse.session.ids'),
    libraryId: nonBlankString,
    sessionId: nonBlankString,
    changeSequence: z.number().int().nonnegative(),
    assetIds: z.array(nonBlankString).max(100_000),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('browse.session.stale'),
    sessionId: nonBlankString,
    reason: z.enum(['library-generation', 'change-sequence', 'missing']),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('browse.session.closed'),
    sessionId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.navigation-summary'),
    summary: libraryNavigationSummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.trashed'),
    trashedCount: z.number().int().nonnegative(),
    operationId: nonBlankString,
    historyEntryId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('selection.trashed'),
    trashedAssetCount: z.number().int().nonnegative(),
    trashedFolderCount: z.number().int().nonnegative(),
    removedFolderCount: z.number().int().nonnegative(),
    historyEntryId: nonBlankString,
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
    dataBase64: z.string(),
    truncated: z.boolean(),
    mimeType: z.string().nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.restored'),
    restoredCount: z.number().int().nonnegative(),
    assets: z.array(assetSummarySchema),
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
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
    historyEntryId: nonBlankString.optional(),
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
    planHash: z.string().regex(/^[a-f0-9]{64}$/u),
    changeSequence: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
    executableCount: z.number().int().nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
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
    // A batch containing only assets that already have AI content is a valid
    // no-op.  Keep the response successful so the renderer can report the
    // skipped assets without turning an idempotent request into a failure.
    jobIds: z.array(nonBlankString),
    skippedAssetIds: z.array(nonBlankString),
    enqueued: z.number().int().nonnegative(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.thumbnail.generated'),
    assetId: nonBlankString,
    // Mirrors media.thumbnail.generated: no artifact for model assets
    // (no Worker raster generator; Serpent-fu2i).
    artifactId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.preview.resolved'),
    assetId: nonBlankString,
    mediaType: z.enum(['image', 'video', 'audio', 'text', 'model', 'document', 'other']),
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
    colorSpacePending: z.boolean().optional(),
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
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.dropped-paths.resolved'),
    assetIds: z.array(nonBlankString),
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
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import-eagle.completed'),
    result: eagleImportResultSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.import-billfish.completed'),
    result: billfishImportResultSchema,
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
    type: z.literal('history.status'),
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.undone'),
    historyEntryId: nonBlankString,
    affectedCount: z.number().int().nonnegative(),
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.redone'),
    historyEntryId: nonBlankString,
    affectedCount: z.number().int().nonnegative(),
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.group.begun'),
    historyEntryId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.group.completed'),
    historyEntryId: nonBlankString,
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.opened'),
    library: internalLibrarySummarySchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.eagle-inspected'),
    displayName: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.billfish-inspected'),
    displayName: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.recovery-report'),
    reportPath: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.recovery-probe'),
    assetId: nonBlankString,
    probe: missingAssetRecoveryProbeSchema,
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
    // Serpent-65d837: set when the root was renamed aside and the aside copy
    // still could not be removed; Main must re-queue it for deferred cleanup.
    pendingAsidePath: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('system.cleanup-pending-deletions'),
    cleanedPaths: z.array(nonBlankString),
    remainingPaths: z.array(nonBlankString),
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
    // Absent for model assets: the Worker has no raster generator for them
    // (slice E owns the offscreen renderer), so the no-op result carries no
    // artifact (Serpent-fu2i).
    artifactId: nonBlankString.optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.retry-artifact.queued'),
    assetId: nonBlankString,
    kind: z.enum(['thumbnail', 'webm_proxy', 'audio_proxy']),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('model.convert-fbx.done'),
    assetId: nonBlankString,
    // 'ready' carries the cached GLB artifact; 'failed' carries a typed
    // error code so the Renderer can route to the FBXLoader fallback.
    status: z.enum(['ready', 'failed']),
    glbArtifactId: nonBlankString.optional(),
    // Path of the GLB artifact relative to `.serpent/artifacts`.
    glbRelativePath: nonBlankString.optional(),
    errorCode: fbxConvertErrorCodeSchema.optional(),
    reason: nonBlankString.optional(),
    stats: fbxConversionStatsSchema.optional(),
    missingTextures: z.array(nonBlankString).optional(),
    warnings: z.array(nonBlankString).optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.artifact-path'),
    artifactId: nonBlankString,
    absolutePath: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.artifact-paths'),
    entries: z.array(z.strictObject({
      artifactId: nonBlankString,
      absolutePath: nonBlankString,
    })),
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
    mediaType: z.enum(['image', 'video', 'audio', 'text', 'model', 'document', 'other']),
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
    colorSpacePending: z.boolean().optional(),
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
  // Slice A (Serpent-fu2i): companion-texture index for a model asset. Only
  // library-relative POSIX paths and ids; no absolute paths (REQ-COMMAND-003).
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('model.companions'),
    assetId: nonBlankString,
    companions: z.array(z.strictObject({
      relativeFilePath: portableRelativePathSchema,
      assetId: nonBlankString,
      revisionId: nonBlankString,
      extension: nonBlankString,
    })).max(1000),
  }),
  // Worker→Main only: absolute paths never enter the renderer result schema.
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.asset-paths'),
    assetIds: z.array(nonBlankString).min(1),
    absolutePaths: z.array(nonBlankString).min(1),
  }),
  // Worker→Main only: a Main cache preheats native drag inputs before a
  // renderer dragstart event. These paths never enter a renderer result.
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.asset-drag-infos'),
    entries: z.array(z.strictObject({
      assetId: nonBlankString,
      absolutePath: nonBlankString,
      thumbnailAbsolutePath: nonBlankString.optional(),
    })).max(10_000),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('media.asset-ids-resolved'),
    assetIds: z.array(nonBlankString),
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
    type: z.literal('asset.thumbnail.visible-window.acknowledged'),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.probed'),
    capabilities: syncCapabilitiesSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.previewed'),
    report: z.strictObject({
      libraryDirectory: nonBlankString,
      newLocal: z.number().int().nonnegative(),
      newRemote: z.number().int().nonnegative(),
      uploads: z.number().int().nonnegative(),
      downloads: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      remoteDeletes: z.number().int().nonnegative(),
      localRecycles: z.number().int().nonnegative(),
      capabilities: syncCapabilitiesSchema,
    }),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.completed'),
    report: z.strictObject({
      libraryDirectory: nonBlankString,
      newLocal: z.number().int().nonnegative(),
      newRemote: z.number().int().nonnegative(),
      uploads: z.number().int().nonnegative(),
      downloads: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      remoteDeletes: z.number().int().nonnegative(),
      localRecycles: z.number().int().nonnegative(),
      capabilities: syncCapabilitiesSchema,
    }),
    conflicts: z.array(z.strictObject({
      syncId: nonBlankString,
      conflictCopyPath: nonBlankString,
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.remote-libraries'),
    remoteLibraries: z.array(z.strictObject({
      libraryId: nonBlankString,
      displayName: nonBlankString,
      directoryName: nonBlankString,
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.poll-remote.result'),
    /** true = 远端 manifest 与本地缓存不一致，需要一次完整同步。 */
    changed: z.boolean(),
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
    type: z.literal('ai.pending-assets'),
    assetIds: z.array(nonBlankString),
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
    type: z.literal('history.status'),
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.undone'),
    historyEntryId: nonBlankString,
    affectedCount: z.number().int().nonnegative(),
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.redone'),
    historyEntryId: nonBlankString,
    affectedCount: z.number().int().nonnegative(),
    status: historyStatusSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.group.begun'),
    historyEntryId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('history.group.completed'),
    historyEntryId: nonBlankString,
    status: historyStatusSchema,
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
    type: z.literal('library.eagle-inspected'),
    displayName: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.eagle-inspect-cancelled'),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.billfish-inspected'),
    displayName: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.billfish-inspect-cancelled'),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('library.recovery-report.requested'),
    libraryId: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.recovery-probe.result'),
    assetId: nonBlankString,
    probe: missingAssetRecoveryProbeSchema,
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
    // Serpent-65d837: true when a leftover .del-* root still needs deferred
    // cleanup; the Renderer shows a notice describing automatic retries.
    pendingCleanup: z.boolean().optional(),
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
  // Slice C (Serpent-qvc6): renderer-side results for the 3D viewer requests.
  // The Worker already emits these (workerSuccessResultSchema); Main passes
  // them through untouched, so they must be parseable here too.
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('asset.thumbnail.visible-window.acknowledged'),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.servers.listed'),
    servers: z.array(z.strictObject({
      id: nonBlankString,
      baseUrl: nonBlankString,
      username: z.string().optional(),
      hasPassword: z.boolean(),
      allowInsecureTls: z.boolean(),
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.server.saved'),
    id: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.server.deleted'),
    id: nonBlankString,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.binding.saved'),
    libraryId: nonBlankString,
    serverId: nonBlankString,
    directoryName: z.string().optional(),
    enabled: z.boolean().optional(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.binding.got'),
    libraryId: nonBlankString,
    binding: z.strictObject({
      serverId: nonBlankString,
      directoryName: z.string().optional(),
      lastSyncedAt: z.string().optional(),
      enabled: z.boolean().optional(),
      pollIntervalMs: z.number().int().min(1000).max(3_600_000).optional(),
    }).nullable(),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.probed'),
    capabilities: syncCapabilitiesSchema,
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.previewed'),
    report: z.strictObject({
      libraryDirectory: nonBlankString,
      newLocal: z.number().int().nonnegative(),
      newRemote: z.number().int().nonnegative(),
      uploads: z.number().int().nonnegative(),
      downloads: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      remoteDeletes: z.number().int().nonnegative(),
      localRecycles: z.number().int().nonnegative(),
      capabilities: syncCapabilitiesSchema,
    }),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.completed'),
    report: z.strictObject({
      libraryDirectory: nonBlankString,
      newLocal: z.number().int().nonnegative(),
      newRemote: z.number().int().nonnegative(),
      uploads: z.number().int().nonnegative(),
      downloads: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      remoteDeletes: z.number().int().nonnegative(),
      localRecycles: z.number().int().nonnegative(),
      capabilities: syncCapabilitiesSchema,
    }),
    conflicts: z.array(z.strictObject({
      syncId: nonBlankString,
      conflictCopyPath: nonBlankString,
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('sync.remote-libraries'),
    remoteLibraries: z.array(z.strictObject({
      libraryId: nonBlankString,
      displayName: nonBlankString,
      directoryName: nonBlankString,
    })),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('model.companions'),
    assetId: nonBlankString,
    companions: z.array(z.strictObject({
      relativeFilePath: portableRelativePathSchema,
      assetId: nonBlankString,
      revisionId: nonBlankString,
      extension: nonBlankString,
    })).max(1000),
  }),
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('model.convert-fbx.done'),
    assetId: nonBlankString,
    // 'ready' carries the cached GLB artifact; 'failed' carries a typed
    // error code so the Renderer can route to the FBXLoader fallback.
    status: z.enum(['ready', 'failed']),
    glbArtifactId: nonBlankString.optional(),
    glbRelativePath: nonBlankString.optional(),
    errorCode: fbxConvertErrorCodeSchema.optional(),
    reason: nonBlankString.optional(),
    stats: fbxConversionStatsSchema.optional(),
    missingTextures: z.array(nonBlankString).optional(),
    warnings: z.array(nonBlankString).optional(),
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
  z.strictObject({
    ok: z.literal(true),
    type: z.literal('ai.pending-assets'),
    assetIds: z.array(nonBlankString),
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

const libraryLifecycleOperationSchema = z.enum([
  'create',
  'open',
  'import',
  'open-eagle',
  'open-billfish',
]);

export const rendererLifecycleEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('library.opening'),
    operation: libraryLifecycleOperationSchema,
    source: z.enum(['mcp']).optional(),
  }),
  z.strictObject({
    type: z.literal('library.opened'),
    library: rendererLibrarySummarySchema,
    // Main-owned automation transitions must be distinguishable from the
    // ordinary renderer request response so App can sync an already-open UI
    // without double-loading normal open requests.
    source: z.enum(['mcp', 'replacement-restore']).optional(),
  }),
  z.strictObject({
    type: z.literal('library.open-failed'),
    operation: libraryLifecycleOperationSchema,
    error: publicErrorSchema,
  }),
  z.strictObject({
    type: z.literal('library.closed'),
    libraryId: nonBlankString,
    source: z.enum(['mcp']).optional(),
  }),
]);

export type RendererLifecycleEvent = z.infer<typeof rendererLifecycleEventSchema>;

export function parseRendererLifecycleEvent(input: unknown): RendererLifecycleEvent {
  return rendererLifecycleEventSchema.parse(input);
}
