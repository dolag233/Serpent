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

/** Metadata attached by Main to every request sent to the Worker. */
export const performanceRequestEnvelopeSchema = z.strictObject({
  lane: performanceLaneSchema,
  sentAtEpochMs: z.number().int().nonnegative(),
  deadlineAtEpochMs: z.number().int().nonnegative().optional(),
  libraryId: z.string().min(1).max(255).optional(),
  libraryGeneration: z.number().int().nonnegative().optional(),
  interactionKey: z.string().min(1).max(512).optional(),
  interactionGeneration: z.number().int().positive().optional(),
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
  'library.import-validate',
  'asset.sequence.create',
  'asset.sequence.dissolve',
  'asset.sequence.dissolve-batch',
  'asset.sequence.set-fps',
  'asset.import.prepare',
  'asset.import-eagle',
  'asset.import-billfish',
  'asset.import.resolve',
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
