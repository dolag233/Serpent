import { z } from 'zod';

/**
 * The Worker-facing scheduling lanes from implementation 0032.  These are
 * internal admission-control metadata; Renderer code never chooses a lane.
 */
export const performanceLaneSchema = z.enum([
  'interactive-control',
  'visible-media',
  'viewer-upgrade',
  'mutation',
  'background-primary',
  'background-secondary',
  'maintenance',
]);

export type PerformanceLane = z.infer<typeof performanceLaneSchema>;

export const performanceReadinessSchema = z.enum([
  'opening',
  'summary-ready',
  'browse-ready',
  'reconciling',
  'ready',
  'degraded',
]);

export type PerformanceReadiness = z.infer<typeof performanceReadinessSchema>;

/** Window or browse-surface identity. Must not be a library-wide key. */
export const performanceConsumerIdSchema = z.string().min(1).max(128);

/**
 * Catalog visibility version. Local reads omit snapshotGeneration; NAS
 * snapshots populate it after the owner publishes an immutable generation.
 */
export const catalogReadVersionSchema = z.strictObject({
  libraryGeneration: z.number().int().nonnegative(),
  catalogSequence: z.number().int().nonnegative(),
  snapshotGeneration: z.number().int().nonnegative().nullable().optional(),
});

export type CatalogReadVersion = z.infer<typeof catalogReadVersionSchema>;

export const catalogReadAdmissionSchema = z.enum(['ok', 'stale']);
export type CatalogReadAdmission = z.infer<typeof catalogReadAdmissionSchema>;

/** Input ack vs durable commit vs UI catching up must not be mixed. */
export const performanceTimingPhaseSchema = z.enum([
  'input-ack',
  'persist',
  'ui-converge',
]);

export type PerformanceTimingPhase = z.infer<typeof performanceTimingPhaseSchema>;

export const MUTATION_RECEIPT_MAX_ENTITY_IDS = 256;

const boundedIdListSchema = z.array(z.string().min(1).max(255)).max(MUTATION_RECEIPT_MAX_ENTITY_IDS);

export const mutationReceiptChangesSchema = z.strictObject({
  folders: z.array(z.unknown()).max(MUTATION_RECEIPT_MAX_ENTITY_IDS).optional(),
  assets: z.array(z.unknown()).max(MUTATION_RECEIPT_MAX_ENTITY_IDS).optional(),
  deletedFolderIds: boundedIdListSchema.optional(),
  deletedAssetIds: boundedIdListSchema.optional(),
  affectedFolderIds: boundedIdListSchema.optional(),
  affectedCollectionIds: boundedIdListSchema.optional(),
  affectedTagIds: boundedIdListSchema.optional(),
  affectedScopeKeys: z.array(z.string().min(1).max(512)).max(MUTATION_RECEIPT_MAX_ENTITY_IDS).optional(),
});

export const mutationReceiptSchema = z.strictObject({
  operationId: z.string().min(1).max(255),
  historyEntryId: z.string().min(1).max(255).optional(),
  committedCatalogSequence: z.number().int().nonnegative(),
  libraryGeneration: z.number().int().nonnegative().optional(),
  snapshotGeneration: z.number().int().nonnegative().nullable().optional(),
  changes: mutationReceiptChangesSchema,
});

export type MutationReceipt = z.infer<typeof mutationReceiptSchema>;

/** Metadata attached by Main to every request sent to the Worker. */
export const performanceRequestEnvelopeSchema = z.strictObject({
  lane: performanceLaneSchema,
  sentAtEpochMs: z.number().int().nonnegative(),
  deadlineAtEpochMs: z.number().int().nonnegative().optional(),
  libraryId: z.string().min(1).max(255).optional(),
  libraryGeneration: z.number().int().nonnegative().optional(),
  consumerId: performanceConsumerIdSchema.optional(),
  interactionKey: z.string().min(1).max(512).optional(),
  interactionGeneration: z.number().int().positive().optional(),
  catalogSequence: z.number().int().nonnegative().optional(),
  snapshotGeneration: z.number().int().nonnegative().nullable().optional(),
  minCatalogSequence: z.number().int().nonnegative().optional(),
});

export type PerformanceRequestEnvelope = z.infer<typeof performanceRequestEnvelopeSchema>;

/** A diagnostic-only span; never contains an absolute filesystem path. */
export const performanceSpanSchema = z.strictObject({
  requestId: z.string().min(1).max(255).optional(),
  ownerId: z.string().min(1).max(255),
  libraryId: z.string().min(1).max(255).optional(),
  assetId: z.string().min(1).max(255).optional(),
  assetName: z.string().max(255).optional(),
  lane: performanceLaneSchema,
  stage: z.string().min(1).max(128),
  queueMs: z.number().nonnegative().optional(),
  executeMs: z.number().nonnegative(),
  itemCount: z.number().int().nonnegative().optional(),
  bytes: z.number().int().nonnegative().optional(),
  cache: z.enum(['hit', 'miss', 'store', 'evict']).optional(),
  outcome: z.enum(['ok', 'cancelled', 'skipped', 'failed']),
  reasonCode: z.string().min(1).max(128).optional(),
});

export type PerformanceSpan = z.infer<typeof performanceSpanSchema>;

type WorkerCommandLike = {
  type: string;
  libraryId?: string;
  assetId?: string;
  [key: string]: unknown;
};

const MUTATION_COMMANDS = new Set([
  'library.create',
  'library.open',
  'library.open-eagle',
  'library.open-billfish',
  'library.close',
  'library.rename',
  'library.delete-from-disk',
  'library.import-folder',
  'library.import-zip',
  'library.import-cancel',
  'asset.delete-cancel',
  'library.import-validate',
  'asset.sequence.create',
  'asset.sequence.dissolve',
  'asset.sequence.dissolve-batch',
  'asset.sequence.set-fps',
  'asset.import.prepare',
  'asset.import-eagle',
  'asset.import-billfish',
  'asset.import.resolve',
  'asset.import.skip-source-failure',
  'asset.import.abandon',
  'asset.import-linked',
  'asset.relink',
  'asset.relink-batch.apply',
  'asset.import-files',
  'asset.import-folder',
  'asset.import-clipboard',
  'asset.import-drop',
  'asset.import-web',
  'asset.import-sequence.confirm',
  'asset.move',
  'asset.copy',
  'asset.trash',
  'asset.restore',
  'asset.restore-preview',
  'asset.move-undo',
  'asset.trash-undo',
  'asset.copy-undo',
  'asset.restore-if-original-vacant',
  'asset.delete-permanent',
  'asset.delete-from-disk',
  'asset.delete-linked',
  'asset.purge-trash',
  'asset.rename-file',
  'asset.rename-files',
  'asset.content.replace',
  'asset.content.replace-batch',
  'asset.content.stage',
  'asset.text.save',
  'extension.save-from-url',
  'extension.save-from-file',
  'folder.create',
  'folder.rename',
  'folder.move',
  'folder.trash',
  'folder.delete-empty',
  'folder.delete-from-disk',
  'folder.restore-trashed',
  'folder.clone',
  'folder.paste',
  'linked-folder.remove',
  'linked-folder.delete-subtree',
  'linked-folder.create-directory',
  'linked-folder.rename-directory',
  'linked-folder.convert',
  'linked-folder.assets.copy',
  'linked-folder.relink',
  'linked-folder.rules.set',
  'ignore.gitignore.set',
  'ignore.set',
  'tag.create',
  'tag.rename',
  'tag.delete',
  'tag.delete-many',
  'tag.merge',
  'tag.assign',
  'tag.remove',
  'collection.create',
  'collection.update',
  'collection.reorder',
  'collection.delete',
  'collection.assets.add',
  'collection.assets.remove',
  'collection.assets.reorder',
  'smart-collection.create',
  'smart-collection.update',
  'smart-collection.delete',
  'ai.configure',
  'ai.set-concurrency-limit',
  'ai.clear-content',
  'asset.metadata.set',
  'asset.metadata.set-many',
  'asset.rating.set',
  'asset.color-space.set',
  'history.undo',
  'history.redo',
  'history.group.begin',
  'history.group.complete',
  'selection.trash',
  'sync.run',
  'sync.open-remote-library',
]);

const VIEWER_UPGRADE_COMMANDS = new Set([
  'asset.preview',
  'asset.text.read',
  'asset.content.read',
  // Resolving a preview may invoke a plugin, decode RAW/OIIO/ICO, inspect
  // colour metadata, or write a viewer artifact. It is not a cheap path read.
  'media.get-preview-artifact',
  'model.resolve-companions',
  'model.convert-fbx',
]);

const INTERACTIVE_CONTROL_COMMANDS = new Set([
  'media.get-artifact-path',
  'media.get-artifact-paths',
  'media.get-thumbnail-artifact',
  'media.get-source-path',
]);

const VISIBLE_MEDIA_COMMANDS = new Set([
  'asset.thumbnail.visible-window',
  'asset.thumbnail.request',
  'media.generate-thumbnail',
]);

const BACKGROUND_PRIMARY_COMMANDS = new Set([
  'asset.refresh',
  'asset.metadata.backfill',
  'library.export',
  'media.enqueue-thumbnail-jobs',
  'media.process-thumbnail-queue',
  'media.retry-artifact',
  'asset.retry-artifact',
  'sync.preview',
]);

const BACKGROUND_SECONDARY_COMMANDS = new Set([
  'asset.analyze',
  'assets.analyze',
  'ai.process-queue',
  'ai.enqueue-analysis',
  // Sidebar hydration is progressive: it must yield between its independent
  // count/list passes so a browse page can enter the Worker while it runs.
  'library.navigation-summary',
  'plugin.jobs.claim-next',
  'plugin.derived-fields.materialize',
]);

const MAINTENANCE_COMMANDS = new Set([
  'sync.poll-remote',
  'library.change-sequence',
  'library.recovery-report',
]);

/** Classify a Main-owned Worker command without exposing lane choice to UI. */
export function performanceLaneForCommand(command: WorkerCommandLike): PerformanceLane {
  if (MUTATION_COMMANDS.has(command.type)) return 'mutation';
  if (VIEWER_UPGRADE_COMMANDS.has(command.type)) return 'viewer-upgrade';
  if (INTERACTIVE_CONTROL_COMMANDS.has(command.type)) return 'interactive-control';
  if (VISIBLE_MEDIA_COMMANDS.has(command.type)) return 'visible-media';
  if (BACKGROUND_PRIMARY_COMMANDS.has(command.type)) return 'background-primary';
  if (BACKGROUND_SECONDARY_COMMANDS.has(command.type)) return 'background-secondary';
  if (MAINTENANCE_COMMANDS.has(command.type)) return 'maintenance';
  return 'interactive-control';
}

/**
 * Return a latest-wins key only for requests whose older queued work is safe
 * to discard. Search keeps its richer Worker-side key because page/count/ids
 * requests intentionally have separate cancellation lanes.
 */
export function performanceInteractionKeyForCommand(command: WorkerCommandLike): string | undefined {
  if (command.type === 'asset.thumbnail.visible-window') return 'visible-window';
  if (command.type === 'sync.asset-card-status') return 'sync-card-status';
  if (command.assetId === undefined) return undefined;
  switch (command.type) {
    case 'asset.preview': return `viewer:${command.assetId}`;
    case 'media.get-preview-artifact': return `preview:${command.assetId}`;
    case 'media.get-source-path': return `source:${command.assetId}`;
    case 'asset.text.read': return `text:${command.assetId}`;
    case 'asset.content.read': return `content:${command.assetId}`;
    default: return undefined;
  }
}

export function isInteractivePerformanceLane(lane: PerformanceLane): boolean {
  return lane === 'interactive-control'
    || lane === 'visible-media'
    || lane === 'viewer-upgrade';
}

/**
 * Browse reads and cheap path lookups are part of the visible-media pipeline.
 * They must not repeatedly abort the thumbnail pump while a scrollbar jump is
 * mounting cards. Explicit viewer upgrades still preempt automatic work, but
 * resolving a source/artifact path is intentionally cheap and non-preemptive.
 */
const NON_PREEMPTIVE_MEDIA_COMMANDS = new Set([
  'asset.search',
  'asset.list',
  'asset.list-trash',
  'folder.list',
  'folder.browse-entries',
  'folder.list-trashed',
  'linked-folder.list',
  'browse.session.open',
  'browse.session.page',
  'browse.session.geometry',
  'browse.session.ids',
  'browse.session.close',
  'history.status',
  'ai.status',
  'sync.asset-card-status',
  'media.list-jobs',
  'media.get-artifact-path',
  'media.get-artifact-paths',
  'media.get-thumbnail-artifact',
  'media.get-source-path',
  'media.resolve-asset-paths',
  'media.get-asset-path',
  'media.get-asset-paths',
  'media.get-asset-drag-infos',
  'plugin.jobs.list',
]);

export function shouldPreemptAutomaticMedia(
  command: WorkerCommandLike,
  lane: PerformanceLane,
): boolean {
  if (lane === 'visible-media') return false;
  return !NON_PREEMPTIVE_MEDIA_COMMANDS.has(command.type);
}

export function isBackgroundPerformanceLane(lane: PerformanceLane): boolean {
  return lane === 'background-primary'
    || lane === 'background-secondary'
    || lane === 'maintenance';
}

/**
 * catalogSequence is the narrowed browse-change fence, not library_change_sequence
 * or a job/artifact cursor.
 */
export function catalogSequenceFromBrowseChangeSequence(changeSequence: number): number {
  if (!Number.isInteger(changeSequence) || changeSequence < 0) {
    throw new RangeError('catalogSequence requires a non-negative integer browse change sequence.');
  }
  return changeSequence;
}

export function resolveCatalogReadAdmission(
  actualCatalogSequence: number,
  minCatalogSequence: number | undefined,
): CatalogReadAdmission {
  if (minCatalogSequence === undefined) return 'ok';
  if (!Number.isInteger(minCatalogSequence) || minCatalogSequence < 0) {
    throw new RangeError('minCatalogSequence must be a non-negative integer.');
  }
  return actualCatalogSequence >= minCatalogSequence ? 'ok' : 'stale';
}

export function catalogReadVersionFields(
  libraryGeneration: number,
  browseChangeSequence: number,
  snapshotGeneration?: number | null,
): CatalogReadVersion {
  return {
    libraryGeneration,
    catalogSequence: catalogSequenceFromBrowseChangeSequence(browseChangeSequence),
    ...(snapshotGeneration === undefined ? {} : { snapshotGeneration }),
  };
}

export type BrokerRoundTripCorrelation = {
  requestId: string;
  sentAtEpochMs: number;
  completedAtEpochMs: number;
  roundTripMs: number;
};

/** Correlate two process clocks by envelope send time, never by subtracting now() values. */
export function correlateBrokerRoundTrip(input: {
  requestId: string;
  sentAtEpochMs: number;
  completedAtEpochMs: number;
}): BrokerRoundTripCorrelation {
  return {
    requestId: input.requestId,
    sentAtEpochMs: input.sentAtEpochMs,
    completedAtEpochMs: input.completedAtEpochMs,
    roundTripMs: Math.max(0, input.completedAtEpochMs - input.sentAtEpochMs),
  };
}

export const DEFAULT_PERFORMANCE_CONSUMER_ID = 'window:default';

export type PerformanceTimingSummary = {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

export const performanceTimingReportSchema = z.strictObject({
  scenario: z.string().min(1).max(128),
  phase: performanceTimingPhaseSchema,
  count: z.number().int().nonnegative(),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  maxMs: z.number().nonnegative(),
});

export type PerformanceTimingReport = z.infer<typeof performanceTimingReportSchema>;

/** Nearest-rank percentiles; empty input is a defined zero summary, not a missing measurement. */
export function summarizeTimingSamples(samplesMs: number[]): PerformanceTimingSummary {
  if (samplesMs.length === 0) {
    return { count: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }
  const ordered = [...samplesMs].sort((left, right) => left - right);
  const at = (percentileValue: number): number => {
    const index = Math.min(
      ordered.length - 1,
      Math.max(0, Math.ceil(ordered.length * percentileValue) - 1),
    );
    return ordered[index]!;
  };
  return {
    count: ordered.length,
    p50Ms: at(0.5),
    p95Ms: at(0.95),
    maxMs: ordered[ordered.length - 1]!,
  };
}

/**
 * Visible-image decode coverage uses the expected visible image set as the
 * denominator. Mounted <img> nodes that never decoded must not shrink it.
 */
export function visibleImageDecodeCoverage(input: {
  expectedVisibleImageCount: number;
  decodedCompleteNaturalWidthPositive: number;
}): { denominator: number; decoded: number; ratio: number } {
  if (!Number.isInteger(input.expectedVisibleImageCount) || input.expectedVisibleImageCount < 0) {
    throw new RangeError('expectedVisibleImageCount must be a non-negative integer.');
  }
  if (
    !Number.isInteger(input.decodedCompleteNaturalWidthPositive)
    || input.decodedCompleteNaturalWidthPositive < 0
  ) {
    throw new RangeError('decodedCompleteNaturalWidthPositive must be a non-negative integer.');
  }
  if (input.decodedCompleteNaturalWidthPositive > input.expectedVisibleImageCount) {
    throw new RangeError('decoded count cannot exceed the visible-image denominator.');
  }
  return {
    denominator: input.expectedVisibleImageCount,
    decoded: input.decodedCompleteNaturalWidthPositive,
    ratio: input.expectedVisibleImageCount === 0
      ? 1
      : input.decodedCompleteNaturalWidthPositive / input.expectedVisibleImageCount,
  };
}
