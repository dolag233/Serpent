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
  pluginJobCheckpointSchema,
  pluginJobControlActionSchema,
  pluginJobItemResultSchema,
  pluginJobSignalActionSchema,
  pluginJobRecordSchema,
  pluginJobRecoveryStrategySchema,
} from '../plugins/plugin-jobs';
import {
  pluginRuntimeActivationFailureCodeSchema,
  pluginRuntimeDeactivateReasonSchema,
  pluginStorageOperationSchema,
  pluginStorageScopeSchema,
} from './plugin-runtime-utility-protocol';
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
const targetLibraryIdSchema = z.string().min(1).max(255).refine(
  (value) => value !== '__serpent_global_runtime__',
  'Global runtime sentinel is not a valid target library.',
);

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
    instanceScope: z.enum(['global', 'library']).default('library'),
    pluginId: pluginIdSchema,
    version: z.string().min(1).max(64),
    packageHash: packageHashSchema,
    packageDirectory: z.string().min(1).max(4_096),
    entryRelativePath: z.string().min(1).max(512),
    permissions: z.array(pluginPermissionSchema).max(64),
    installScope: z.enum(['user', 'library']).default('library'),
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
    type: z.literal('plugin-trusted.storage-result'),
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
    type: z.literal('plugin-trusted.shutdown'),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.domain-event'),
    instanceId: instanceIdSchema,
    event: pluginDomainEventSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.hook-invoke'),
    instanceId: instanceIdSchema,
    invoke: pluginHookInvokeSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-invoke'),
    instanceId: instanceIdSchema,
    job: pluginJobRecordSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-signal'),
    instanceId: instanceIdSchema,
    jobId: z.string().uuid(),
    action: pluginJobSignalActionSchema,
    reason: z.string().max(1_024).optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.provider-invoke'),
    instanceId: instanceIdSchema,
    invoke: pluginProviderInvokeSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.search-request'),
    instanceId: instanceIdSchema,
    request: pluginSearchRequestSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.search-cancel'),
    instanceId: instanceIdSchema,
    cancel: pluginSearchCancelSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.command-invoke'),
    instanceId: instanceIdSchema,
    invoke: pluginCommandInvokeSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-enqueue-result'),
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
    type: z.literal('plugin-trusted.job-control-result'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    ok: z.boolean(),
    job: pluginJobRecordSchema.nullable().optional(),
    error: z.strictObject({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(1_024),
    }).optional(),
  }).superRefine((value, context) => {
    if (value.ok && value.error !== undefined) context.addIssue({ code: 'custom', path: ['error'], message: 'Successful job controls cannot contain an error.' });
    if (!value.ok && value.error === undefined) context.addIssue({ code: 'custom', path: ['error'], message: 'Failed job controls need an error.' });
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.input-capture.started'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    sessionId: requestIdSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.input-capture.event'),
    instanceId: instanceIdSchema,
    sessionId: requestIdSchema,
    event: pluginInputCaptureEventSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.input-capture.end'),
    instanceId: instanceIdSchema,
    sessionId: requestIdSchema,
    reason: pluginInputCaptureEndReasonSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.input-capture.error'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    code: pluginInputCaptureErrorCodeSchema,
    message: z.string().min(1).max(1_024),
  }),
]);
export type PluginTrustedParentMessage = z.infer<typeof pluginTrustedParentMessageSchema>;

export const pluginTrustedChildMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('plugin-trusted.ready') }),
  z.strictObject({ type: z.literal('plugin-trusted.heartbeat') }),
  z.strictObject({
    type: z.literal('plugin-trusted.event'),
    instanceId: instanceIdSchema,
    eventType: z.string().min(1).max(128),
    critical: z.boolean().default(false),
    payload: z.unknown(),
  }),
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
    targetLibraryId: targetLibraryIdSchema.optional(),
    causeChain: pluginCauseChainSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.storage-request'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    operation: pluginStorageOperationSchema,
    scope: pluginStorageScopeSchema.optional(),
    key: z.string().min(1).max(128).optional(),
    value: z.unknown().optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.console'),
    instanceId: instanceIdSchema,
    level: z.enum(['log', 'warn', 'error']),
    message: z.string().max(4_096),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.hook-decision'),
    instanceId: instanceIdSchema,
    invokeId: requestIdSchema,
    decision: pluginHookDecisionSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-enqueue'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    handlerId: z.string().min(1).max(128),
    payload: z.record(z.string(), z.unknown()).default({}),
    recoveryStrategy: pluginJobRecoveryStrategySchema.optional(),
    targetLibraryId: targetLibraryIdSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-control'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    jobId: z.string().uuid(),
    action: pluginJobControlActionSchema,
    reason: z.string().max(1_024).optional(),
    retryInput: z.record(z.string(), z.unknown()).optional(),
    checkpoint: pluginJobCheckpointSchema.optional(),
    targetLibraryId: targetLibraryIdSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-complete'),
    instanceId: instanceIdSchema,
    jobId: z.string().uuid(),
    status: pluginJobCompleteSchema.shape.status,
    errorCode: z.string().min(1).max(128).optional(),
    errorDetail: z.string().max(4_096).optional(),
    progress: z.number().min(0).max(1).optional(),
    completed: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    phase: z.string().max(128).optional(),
    message: z.string().max(1_024).optional(),
    itemResults: z.array(pluginJobItemResultSchema).max(100_000).optional(),
    failedAssetIds: z.array(z.string().min(1).max(255)).max(100_000).optional(),
    retryInput: z.record(z.string(), z.unknown()).optional(),
    checkpoint: pluginJobCheckpointSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.job-progress'),
    instanceId: instanceIdSchema,
    jobId: z.string().uuid(),
    progress: z.strictObject({
      completed: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      phase: z.string().max(128),
      message: z.string().max(1_024),
      progress: z.number().min(0).max(1).optional(),
    }).superRefine((value, context) => {
      if (value.completed > value.total) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['completed'],
          message: 'completed cannot exceed total.',
        });
      }
    }),
    targetLibraryId: targetLibraryIdSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.provider-complete'),
    instanceId: instanceIdSchema,
    ...pluginProviderBatchResultSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.search-chunk'),
    instanceId: instanceIdSchema,
    ...pluginSearchChunkSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.search-complete'),
    instanceId: instanceIdSchema,
    ...pluginSearchCompleteSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.command-complete'),
    instanceId: instanceIdSchema,
    ...pluginCommandCompleteSchema.shape,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.input-capture.start'),
    instanceId: instanceIdSchema,
    requestId: requestIdSchema,
    options: pluginInputCaptureOptionsSchema,
  }),
  z.strictObject({
    type: z.literal('plugin-trusted.input-capture.release'),
    instanceId: instanceIdSchema,
    sessionId: requestIdSchema,
  }),
]);
export type PluginTrustedChildMessage = z.infer<typeof pluginTrustedChildMessageSchema>;

export type PluginTrustedChildProtocolResult =
  | { kind: 'message'; message: PluginTrustedChildMessage }
  | { kind: 'ignored-event'; eventType: string; instanceId?: string }
  | { kind: 'fault'; reason: string; instanceId?: string };

const trustedProtocolRecordSchema = z.record(z.string(), z.unknown());

export function parsePluginTrustedChildMessage(raw: unknown): PluginTrustedChildProtocolResult {
  const parsed = pluginTrustedChildMessageSchema.safeParse(raw);
  if (parsed.success) {
    if (parsed.data.type === 'plugin-trusted.event') {
      return parsed.data.critical
        ? { kind: 'fault', reason: `Unknown critical event: ${parsed.data.eventType}.`, instanceId: parsed.data.instanceId }
        : { kind: 'ignored-event', eventType: parsed.data.eventType, instanceId: parsed.data.instanceId };
    }
    return { kind: 'message', message: parsed.data };
  }
  const record = trustedProtocolRecordSchema.safeParse(raw).success
    ? raw as Record<string, unknown>
    : undefined;
  const type = typeof record?.type === 'string' ? record.type : undefined;
  const instanceId = typeof record?.instanceId === 'string' ? record.instanceId : undefined;
  const isExplicitEvent = type === 'plugin-trusted.event'
    || record?.kind === 'event'
    || typeof record?.eventType === 'string'
    || type?.includes('.event.') === true
    || type?.endsWith('-event') === true;
  const isCritical = record?.critical === true
    || record?.kind === 'control'
    || type?.includes('.control.') === true
    || type?.endsWith('.control') === true;
  if (isExplicitEvent && !isCritical) {
    return {
      kind: 'ignored-event',
      eventType: typeof record?.eventType === 'string' ? record.eventType : type ?? 'unknown',
      ...(instanceId === undefined ? {} : { instanceId }),
    };
  }
  return {
    kind: 'fault',
    reason: type === undefined ? 'Child message has no protocol type.' : `Invalid or unknown control message: ${type}.`,
    ...(instanceId === undefined ? {} : { instanceId }),
  };
}
