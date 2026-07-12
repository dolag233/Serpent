import { z } from 'zod';

import { assetSummarySchema, linkedFolderSummarySchema, managedFolderSummarySchema } from '../asset-types';
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
    operation: z.enum(['create', 'open']),
  }),
  z.strictObject({
    type: z.literal('library.opened'),
    library: rendererLibrarySummarySchema,
  }),
  z.strictObject({
    type: z.literal('library.open-failed'),
    operation: z.enum(['create', 'open']),
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
