import { z } from 'zod';

import { automationScriptCommandIdSchema } from './automation-script-api';
import { pluginPermissionSchema } from '../plugins/plugin-manifest';
import {
  pluginRuntimeActivationFailureCodeSchema,
  pluginRuntimeDeactivateReasonSchema,
} from './plugin-runtime-utility-protocol';

const instanceIdSchema = z.string().uuid();
const requestIdSchema = z.string().uuid();
const packageHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pluginIdSchema = z.string().min(1).max(255);

/**
 * Trusted Host messages. Unlike the standard Host, activate carries a verified
 * package directory so the child can load Node modules; Main still never
 * evaluates plugin code itself.
 */
export const pluginTrustedParentMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('plugin-trusted.activate'),
    instanceId: instanceIdSchema,
    libraryId: z.string().min(1).max(255),
    pluginId: pluginIdSchema,
    version: z.string().min(1).max(64),
    packageHash: packageHashSchema,
    packageDirectory: z.string().min(1).max(4_096),
    entryRelativePath: z.string().min(1).max(512),
    permissions: z.array(pluginPermissionSchema).max(64),
    activateDeadlineMs: z.number().int().positive().max(120_000).default(15_000),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.deactivate'),
    instanceId: instanceIdSchema,
    reason: pluginRuntimeDeactivateReasonSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.host-result'),
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
    type: z.literal('plugin-trusted.shutdown'),
  }),
]);
export type PluginTrustedParentMessage = z.infer<typeof pluginTrustedParentMessageSchema>;

export const pluginTrustedChildMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plugin-trusted.ready') }),
  z.strictObject({ type: z.literal('plugin-trusted.heartbeat') }),
  z.strictObject({
    type: z.literal('plugin-trusted.activated'),
    instanceId: instanceIdSchema,
    pluginId: pluginIdSchema,
    packageHash: packageHashSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.activation-failed'),
    instanceId: instanceIdSchema,
    code: pluginRuntimeActivationFailureCodeSchema,
    message: z.string().min(1).max(4_096),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.deactivated'),
    instanceId: instanceIdSchema,
    reason: pluginRuntimeDeactivateReasonSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.host-command'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    commandId: automationScriptCommandIdSchema,
    input: z.unknown(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.console'),
    instanceId: instanceIdSchema,
    level: z.enum(['log', 'warn', 'error']),
    message: z.string().max(4_096),
  }),
]);
export type PluginTrustedChildMessage = z.infer<typeof pluginTrustedChildMessageSchema>;
