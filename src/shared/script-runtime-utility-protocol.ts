import { z } from 'zod';

import { automationScriptCommandIdSchema } from './automation-script-api';
import { automationScriptHostErrorSchema, type AutomationScriptHostError } from './automation-host-command-error';

const executionIdSchema = z.string().min(1).max(255);
const requestIdSchema = z.string().uuid();
const sourceSchema = z.string().min(1).max(64 * 1024);

export const scriptRuntimeErrorCodeSchema = z.enum([
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
export type ScriptRuntimeErrorCode = z.infer<typeof scriptRuntimeErrorCodeSchema>;

export const scriptRuntimeLimitOverridesSchema = z.strictObject({
  cpuTimeoutMs: z.number().int().positive().optional(),
  wallTimeoutMs: z.number().int().positive().optional(),
  memoryLimitBytes: z.number().int().positive().optional(),
  maxStackBytes: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().optional(),
  maxPendingHostCalls: z.number().int().positive().optional(),
  maxPendingGuestPromises: z.number().int().positive().optional(),
  maxPendingJobBatches: z.number().int().positive().optional(),
  maxSourceBytes: z.number().int().positive().optional(),
});
export type ScriptRuntimeLimitOverrides = z.infer<typeof scriptRuntimeLimitOverridesSchema>;

export const scriptRuntimeParentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('script-runtime.run'),
    executionId: executionIdSchema,
    source: sourceSchema,
    limits: scriptRuntimeLimitOverridesSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('script-runtime.abort'),
    executionId: executionIdSchema,
  }),
  z.strictObject({
    type: z.literal('script-runtime.host-result'),
    executionId: executionIdSchema,
    requestId: requestIdSchema,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: automationScriptHostErrorSchema.optional(),
  }).superRefine((value, context) => {
    if (value.ok && value.error !== undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Successful host results cannot contain an error.' });
    }
    if (!value.ok && value.error === undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Failed host results need an error.' });
    }
  }),
]);
export type ScriptRuntimeParentMessage = z.infer<typeof scriptRuntimeParentMessageSchema>;

export type ScriptRuntimeHostFailure = AutomationScriptHostError;

export const scriptRuntimeChildMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('script-runtime.ready') }),
  z.strictObject({
    type: z.literal('script-runtime.host-command'),
    executionId: executionIdSchema,
    requestId: requestIdSchema,
    commandId: automationScriptCommandIdSchema,
    input: z.unknown(),
  }),
  z.strictObject({
    type: z.literal('script-runtime.completed'),
    executionId: executionIdSchema,
    value: z.unknown(),
    output: z.array(z.string().max(16 * 1024)).max(8_192),
    transpiledJavaScript: z.string().max(256 * 1024),
  }),
  z.strictObject({
    type: z.literal('script-runtime.failed'),
    executionId: executionIdSchema,
    code: scriptRuntimeErrorCodeSchema,
    message: z.string().min(1).max(4_096),
    guestStack: z.string().max(32 * 1024).optional(),
  }),
]);
export type ScriptRuntimeChildMessage = z.infer<typeof scriptRuntimeChildMessageSchema>;
