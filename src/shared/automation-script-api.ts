import { z } from 'zod';

import { publicErrorSchema, type PublicError } from './protocol/errors';

const identifier = z.string().uuid();
const source = z.string().min(1).max(64 * 1024);

/** Text syntax is parsed in Main with the same grammar as the desktop toolbar. */
export const automationScriptAssetSearchInputSchema = z.strictObject({
  query: z.string().max(4_096).nullable(),
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type AutomationScriptAssetSearchInput = z.infer<typeof automationScriptAssetSearchInputSchema>;

export const automationScriptCommandIdSchema = z.enum([
  'folder.list',
  'asset.list',
  'asset.metadata.get',
  'asset.search',
  'asset.rating.set',
  'asset.paths.copy',
  'asset.trash',
  'asset.rename-file',
  'asset.rename-files',
  'asset.list-trash',
  'asset.restore-if-original-vacant',
  'asset.palette.aggregate-recent',
]);
export type AutomationScriptCommandId = z.infer<typeof automationScriptCommandIdSchema>;

export const automationScriptStartInputSchema = z.strictObject({
  libraryId: identifier,
  source,
});
export type AutomationScriptStartInput = z.infer<typeof automationScriptStartInputSchema>;

export const automationScriptStartResultSchema = z.union([
  z.strictObject({
    ok: z.literal(true),
    executionId: z.string().min(1),
    logId: z.string().min(1),
  }),
  z.strictObject({ ok: z.literal(false), error: publicErrorSchema }),
]);
export type AutomationScriptStartResult = z.infer<typeof automationScriptStartResultSchema>;

export const automationScriptCommandInputSchema = z.strictObject({
  executionId: z.string().min(1),
  commandId: automationScriptCommandIdSchema,
  input: z.unknown(),
});
export type AutomationScriptCommandInput = z.infer<typeof automationScriptCommandInputSchema>;

export type AutomationScriptCommandResult =
  | { ok: true; result: unknown }
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

export interface SerpentAutomationScriptApi {
  start(input: AutomationScriptStartInput): Promise<AutomationScriptStartResult>;
  command(input: AutomationScriptCommandInput): Promise<AutomationScriptCommandResult>;
  complete(input: AutomationScriptCompleteInput): Promise<void>;
  cancel(input: AutomationScriptCancelInput): Promise<void>;
}
