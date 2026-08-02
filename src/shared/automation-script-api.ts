import { z } from 'zod';

import { publicErrorSchema, type PublicError } from './protocol/errors';

const identifier = z.string().uuid();
export const automationScriptSourceSchema = z.string().min(1).max(64 * 1024);

/** Text syntax is parsed in Main with the same grammar as the desktop toolbar. */
export const automationScriptAssetSearchInputSchema = z.strictObject({
  query: z.string().max(4_096).nullable(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type AutomationScriptAssetSearchInput = z.infer<typeof automationScriptAssetSearchInputSchema>;

export const automationScriptCommandIdSchema = z.enum([
  'library.create',
  'file.import',
  'folder.list',
  'folder.create',
  'asset.list',
  'asset.metadata.get',
  'asset.metadata.set',
  'asset.ai-content.get',
  'asset.extracted-metadata.get',
  'asset.search',
  'asset.rating.set',
  'asset.paths.copy',
  'asset.trash',
  'asset.content.read',
  'asset.content.replace',
  'asset.content.stage',
  'asset.content.replace-batch',
  'asset.move',
  'asset.rename-file',
  'asset.rename-files',
  'asset.list-trash',
  'asset.restore-if-original-vacant',
  'asset.palette.aggregate-recent',
  'library.inspect',
  'library.change-sequence',
  'linked-folder.list',
  'tag.list',
  'tag.create',
  'tag.assign',
  'tag.remove',
  'collection.list',
  'collection.create',
  'collection.assets.add',
  'collection.assets.remove',
  'collection.assets.memberships',
  'smart-collection.list',
  'media.jobs.list',
  'ai.jobs.status',
  'ai.enqueue',
  'ui.notify',
]);
export type AutomationScriptCommandId = z.infer<typeof automationScriptCommandIdSchema>;

export const automationScriptStartInputSchema = z.strictObject({
  libraryId: identifier.nullable(),
  source: automationScriptSourceSchema,
  /** Main-issued handle for exact text loaded from or saved to a script file. */
  scriptId: identifier.optional(),
});
export type AutomationScriptStartInput = z.infer<typeof automationScriptStartInputSchema>;

export const automationScriptStartResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    executionId: z.string().min(1),
    logId: z.string().min(1),
    capabilities: z.array(z.string().min(1)).max(128),
  }),
  z.strictObject({ ok: z.literal(false), error: publicErrorSchema }),
]);
export type AutomationScriptStartResult = z.infer<typeof automationScriptStartResultSchema>;

export const automationScriptFileResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    scriptId: identifier,
    displayName: z.string().min(1).max(255),
    source: automationScriptSourceSchema,
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['cancelled', 'invalid-script-file', 'source-too-large', 'io-failed', 'recent-script-not-found']),
  }),
]);
export type AutomationScriptFileResult = z.infer<typeof automationScriptFileResultSchema>;

export const automationRecentScriptEntrySchema = z.strictObject({
  handle: identifier,
  displayName: z.string().min(1).max(255),
  lastOpenedAt: z.string().min(1),
});
export type AutomationRecentScriptEntry = z.infer<typeof automationRecentScriptEntrySchema>;

export const automationRecentScriptsListResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    entries: z.array(automationRecentScriptEntrySchema).max(12),
  }),
  z.strictObject({
    ok: z.literal(false),
    code: z.enum(['io-failed']),
  }),
]);
export type AutomationRecentScriptsListResult = z.infer<typeof automationRecentScriptsListResultSchema>;

export const automationRecentScriptOpenInputSchema = z.strictObject({
  handle: identifier,
});
export type AutomationRecentScriptOpenInput = z.infer<typeof automationRecentScriptOpenInputSchema>;

export const automationScriptSaveInputSchema = z.strictObject({
  source: automationScriptSourceSchema,
});
export type AutomationScriptSaveInput = z.infer<typeof automationScriptSaveInputSchema>;

/**
 * Source is deliberately absent: Main binds the approved source hash to the
 * execution at `start`, so a renderer cannot swap code after authorization.
 */
export const automationScriptExecuteInputSchema = z.strictObject({
  executionId: z.string().min(1),
});
export type AutomationScriptExecuteInput = z.infer<typeof automationScriptExecuteInputSchema>;

export const automationScriptRuntimeFailureCodeSchema = z.enum([
  'SOURCE_NOT_ALLOWED',
  'SOURCE_TOO_LARGE',
  'CPU_TIMEOUT',
  'WALL_TIMEOUT',
  'CANCELLED',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'HOST_CALL_LIMIT',
  'PROMISE_LIMIT',
  'RUNTIME_ERROR',
  'RUNTIME_PROCESS_EXITED',
  'RUNTIME_PROTOCOL_ERROR',
]);
export type AutomationScriptRuntimeFailureCode = z.infer<typeof automationScriptRuntimeFailureCodeSchema>;

export const automationScriptExecuteResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    value: z.unknown(),
    output: z.array(z.string().max(16 * 1024)).max(8_192),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({
      code: automationScriptRuntimeFailureCodeSchema,
      message: z.string().min(1).max(4_096),
      guestStack: z.string().max(32 * 1024).optional(),
    }),
  }),
]);
export type AutomationScriptExecuteResult = z.infer<typeof automationScriptExecuteResultSchema>;

export const automationScriptCommandInputSchema = z.strictObject({
  executionId: z.string().min(1),
  commandId: automationScriptCommandIdSchema,
  input: z.unknown(),
});
export type AutomationScriptCommandInput = z.infer<typeof automationScriptCommandInputSchema>;

export type AutomationScriptCommandResult =
  | { ok: true; result: unknown; undoGroupId?: string }
  | { ok: false; error: PublicError };

export const automationScriptCompleteInputSchema = z.strictObject({
  executionId: z.string().min(1),
  succeeded: z.boolean(),
  cancelled: z.boolean().optional(),
});
export type AutomationScriptCompleteInput = z.infer<typeof automationScriptCompleteInputSchema>;

export const automationScriptCancelInputSchema = z.strictObject({
  executionId: z.string().min(1),
});
export type AutomationScriptCancelInput = z.infer<typeof automationScriptCancelInputSchema>;

export const automationScriptHistoryInputSchema = z.strictObject({
  libraryId: identifier,
  limit: z.number().int().min(1).max(100).default(20),
});
export type AutomationScriptHistoryInput = z.infer<typeof automationScriptHistoryInputSchema>;

export const automationScriptHistoryEntrySchema = z.strictObject({
  executionId: z.string().min(1),
  logId: z.string().min(1),
  source: z.enum(['desktop-console', 'script', 'mcp', 'test', 'plugin']),
  status: z.string().min(1).max(64),
  commandCount: z.number().int().nonnegative(),
  succeededCommandCount: z.number().int().nonnegative(),
  failedCommandCount: z.number().int().nonnegative(),
  failureCode: z.string().max(128).nullable(),
  createdAt: z.string().min(1),
  finishedAt: z.string().nullable(),
});
export type AutomationScriptHistoryEntry = z.infer<typeof automationScriptHistoryEntrySchema>;

export const automationScriptHistoryResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    entries: z.array(automationScriptHistoryEntrySchema).max(100),
  }),
  z.strictObject({ ok: z.literal(false), error: publicErrorSchema }),
]);
export type AutomationScriptHistoryResult = z.infer<typeof automationScriptHistoryResultSchema>;

export const automationScriptUndoInputSchema = z.strictObject({
  executionId: z.string().min(1),
  undoGroupId: z.string().min(1).optional(),
});
export type AutomationScriptUndoInput = z.infer<typeof automationScriptUndoInputSchema>;

export const automationScriptUndoResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    undoGroupId: z.string().min(1),
    undoneCount: z.number().int().nonnegative(),
    skippedCount: z.number().int().nonnegative(),
  }),
  z.strictObject({ ok: z.literal(false), error: publicErrorSchema }),
]);
export type AutomationScriptUndoResult = z.infer<typeof automationScriptUndoResultSchema>;

export interface SerpentAutomationScriptApi {
  open(): Promise<AutomationScriptFileResult>;
  save(input: AutomationScriptSaveInput): Promise<AutomationScriptFileResult>;
  recentList(): Promise<AutomationRecentScriptsListResult>;
  openRecent(input: AutomationRecentScriptOpenInput): Promise<AutomationScriptFileResult>;
  start(input: AutomationScriptStartInput): Promise<AutomationScriptStartResult>;
  execute(input: AutomationScriptExecuteInput): Promise<AutomationScriptExecuteResult>;
  command(input: AutomationScriptCommandInput): Promise<AutomationScriptCommandResult>;
  complete(input: AutomationScriptCompleteInput): Promise<void>;
  cancel(input: AutomationScriptCancelInput): Promise<void>;
  history(input: AutomationScriptHistoryInput): Promise<AutomationScriptHistoryResult>;
  undo(input: AutomationScriptUndoInput): Promise<AutomationScriptUndoResult>;
}
