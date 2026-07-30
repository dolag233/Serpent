import { z } from 'zod';

import { automationScriptCommandIdSchema } from './automation-script-api';
import { pluginPermissionSchema } from '../plugins/plugin-manifest';

const instanceIdSchema = z.string().uuid();
const requestIdSchema = z.string().uuid();
const packageHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pluginIdSchema = z.string().min(1).max(255);

export const pluginRuntimeActivationFailureCodeSchema = z.enum([
  'ENTRY_INVALID',
  'ACTIVATE_REJECTED',
  'RUNTIME_ERROR',
  'WALL_TIMEOUT',
  'CANCELLED',
  'MEMORY_LIMIT',
  'OUTPUT_LIMIT',
  'HOST_CALL_LIMIT',
  'PROMISE_LIMIT',
  'CPU_TIMEOUT',
  'RUNTIME_PROCESS_EXITED',
  'RUNTIME_PROTOCOL_ERROR',
]);
export type PluginRuntimeActivationFailureCode = z.infer<typeof pluginRuntimeActivationFailureCodeSchema>;

export const pluginRuntimeDeactivateReasonSchema = z.enum([
  'library-closed',
  'trust-revoked',
  'resolution-changed',
  'safe-mode',
  'supervisor-shutdown',
  'activation-replaced',
]);
export type PluginRuntimeDeactivateReason = z.infer<typeof pluginRuntimeDeactivateReasonSchema>;

export const pluginRuntimeParentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plugin-runtime.activate'),
    instanceId: instanceIdSchema,
    libraryId: z.string().min(1).max(255),
    pluginId: pluginIdSchema,
    version: z.string().min(1).max(64),
    packageHash: packageHashSchema,
    entryJavaScript: z.string().min(1).max(512 * 1024),
    permissions: z.array(pluginPermissionSchema).max(64),
    activateDeadlineMs: z.number().int().positive().max(120_000).default(10_000),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.deactivate'),
    instanceId: instanceIdSchema,
    reason: pluginRuntimeDeactivateReasonSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.host-result'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.strictObject({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(1_024),
    }).optional(),
  }).superRefine((value, context) => {
    if (value.ok && value.error !== undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Successful host results cannot contain an error.' });
    }
    if (!value.ok && value.error === undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Failed host results need an error.' });
    }
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.shutdown'),
  }),
]);
export type PluginRuntimeParentMessage = z.infer<typeof pluginRuntimeParentMessageSchema>;

export const pluginRuntimeChildMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plugin-runtime.ready') }),
  z.strictObject({
    type: z.literal('plugin-runtime.activated'),
    instanceId: instanceIdSchema,
    pluginId: pluginIdSchema,
    packageHash: packageHashSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.activation-failed'),
    instanceId: instanceIdSchema,
    code: pluginRuntimeActivationFailureCodeSchema,
    message: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.deactivated'),
    instanceId: instanceIdSchema,
    reason: pluginRuntimeDeactivateReasonSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.host-command'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    commandId: automationScriptCommandIdSchema,
    input: z.unknown(),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.console'),
    instanceId: instanceIdSchema,
    level: z.enum(['log', 'warn', 'error']),
    message: z.string().max(4_096),
  }),
]);
export type PluginRuntimeChildMessage = z.infer<typeof pluginRuntimeChildMessageSchema>;
