import { z } from 'zod';

import { automationScriptCommandIdSchema } from './automation-script-api';
import { pluginPermissionSchema } from '../plugins/plugin-manifest';
import {
  pluginCauseChainSchema,
  pluginDomainEventSchema,
} from '../plugins/plugin-domain-events';
import {
  pluginHookDecisionSchema,
  pluginHookInvokeSchema,
} from '../plugins/plugin-hooks';
import {
  pluginJobCompleteSchema,
  pluginJobRecordSchema,
  pluginJobRecoveryStrategySchema,
} from '../plugins/plugin-jobs';
import {
  pluginCommandCompleteSchema,
  pluginCommandInvokeSchema,
} from '../plugins/plugin-commands';
import {
  pluginProviderBatchResultSchema,
  pluginProviderInvokeSchema,
} from '../plugins/plugin-providers';
import {
  pluginSearchCancelSchema,
  pluginSearchChunkSchema,
  pluginSearchCompleteSchema,
  pluginSearchRequestSchema,
} from '../plugins/plugin-search';
import {
  pluginInputCaptureEndReasonSchema,
  pluginInputCaptureEventSchema,
  pluginInputCaptureOptionsSchema,
} from './plugin-input-capture';
import { pluginInputCaptureErrorCodeSchema } from './plugin-input-capture-protocol';

const instanceIdSchema = z.string().uuid();
const requestIdSchema = z.string().uuid();
const packageHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const pluginIdSchema = z.string().min(1).max(255);

export const pluginStorageScopeSchema = z.enum(['library', 'user']);
export type PluginStorageScopeMessage = z.infer<typeof pluginStorageScopeSchema>;
export const pluginStorageOperationSchema = z.enum(['get', 'set', 'delete', 'list', 'get-directory']);
export type PluginStorageOperation = z.infer<typeof pluginStorageOperationSchema>;

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
  'HEARTBEAT_TIMEOUT',
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
    instanceScope: z.enum(['global', 'library']).default('library'),
    pluginId: pluginIdSchema,
    version: z.string().min(1).max(64),
    packageHash: packageHashSchema,
    entryJavaScript: z.string().min(1).max(512 * 1024),
    installScope: z.enum(['user', 'library']).default('library'),
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
  z.strictObject({
    type: z.literal('plugin-runtime.storage-result'),
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
      context.addIssue({ code: 'custom', path: ['error'], message: 'Successful storage results cannot contain an error.' });
    }
    if (!value.ok && value.error === undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Failed storage results need an error.' });
    }
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.domain-event'),
    instanceId: instanceIdSchema,
    event: pluginDomainEventSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.hook-invoke'),
    instanceId: instanceIdSchema,
    invoke: pluginHookInvokeSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.job-invoke'),
    instanceId: instanceIdSchema,
    job: pluginJobRecordSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.provider-invoke'),
    instanceId: instanceIdSchema,
    invoke: pluginProviderInvokeSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.search-request'),
    instanceId: instanceIdSchema,
    request: pluginSearchRequestSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.search-cancel'),
    instanceId: instanceIdSchema,
    cancel: pluginSearchCancelSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.command-invoke'),
    instanceId: instanceIdSchema,
    invoke: pluginCommandInvokeSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.job-enqueue-result'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    ok: z.boolean(),
    result: z.strictObject({
      jobId: z.string().uuid(),
    }).optional(),
    error: z.strictObject({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(1_024),
    }).optional(),
  }).superRefine((value, context) => {
    if (value.ok && value.error !== undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Successful job enqueue results cannot contain an error.' });
    }
    if (!value.ok && value.error === undefined) {
      context.addIssue({ code: 'custom', path: ['error'], message: 'Failed job enqueue results need an error.' });
    }
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.input-capture.started'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    sessionId: requestIdSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.input-capture.event'),
    instanceId: instanceIdSchema,
    sessionId: requestIdSchema,
    event: pluginInputCaptureEventSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.input-capture.end'),
    instanceId: instanceIdSchema,
    sessionId: requestIdSchema,
    reason: pluginInputCaptureEndReasonSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.input-capture.error'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    code: pluginInputCaptureErrorCodeSchema,
    message: z.string().min(1).max(1_024),
  }),
]);
export type PluginRuntimeParentMessage = z.infer<typeof pluginRuntimeParentMessageSchema>;

export const pluginRuntimeChildMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plugin-runtime.ready') }),
  z.strictObject({ type: z.literal('plugin-runtime.heartbeat') }),
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
    causeChain: pluginCauseChainSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.storage-request'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    operation: pluginStorageOperationSchema,
    scope: pluginStorageScopeSchema.optional(),
    key: z.string().min(1).max(128).optional(),
    value: z.unknown().optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.console'),
    instanceId: instanceIdSchema,
    level: z.enum(['log', 'warn', 'error']),
    message: z.string().max(4_096),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.hook-decision'),
    instanceId: instanceIdSchema,
    invokeId: requestIdSchema,
    decision: pluginHookDecisionSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.job-enqueue'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    handlerId: z.string().min(1).max(128),
    payload: z.record(z.string(), z.unknown()).default({}),
    recoveryStrategy: pluginJobRecoveryStrategySchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.job-complete'),
    instanceId: instanceIdSchema,
    jobId: z.string().uuid(),
    status: pluginJobCompleteSchema.shape.status,
    errorCode: z.string().min(1).max(128).optional(),
    errorDetail: z.string().max(4_096).optional(),
    progress: z.number().min(0).max(1).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.provider-complete'),
    instanceId: instanceIdSchema,
    ...pluginProviderBatchResultSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.search-chunk'),
    instanceId: instanceIdSchema,
    ...pluginSearchChunkSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.search-complete'),
    instanceId: instanceIdSchema,
    ...pluginSearchCompleteSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.command-complete'),
    instanceId: instanceIdSchema,
    ...pluginCommandCompleteSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.input-capture.start'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    options: pluginInputCaptureOptionsSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-runtime.input-capture.release'),
    instanceId: instanceIdSchema,
    sessionId: requestIdSchema,
  }),
]);
export type PluginRuntimeChildMessage = z.infer<typeof pluginRuntimeChildMessageSchema>;
