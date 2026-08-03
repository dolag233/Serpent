import { z } from 'zod';

/** Fixed jobs.kind for all plugin-owned background work. */
export const PLUGIN_BACKGROUND_JOB_KIND = 'plugin.background' as const;

export const pluginJobRecoveryStrategySchema = z.enum(['idempotent', 'checkpoint']);
export type PluginJobRecoveryStrategy = z.infer<typeof pluginJobRecoveryStrategySchema>;

export const pluginJobOwnerScopeSchema = z.enum(['library', 'global']);
export type PluginJobOwnerScope = z.infer<typeof pluginJobOwnerScopeSchema>;

export const pluginJobOwnerSchema = z.strictObject({
  pluginId: z.string().min(1).max(255),
  pluginInstanceId: z.string().min(1).max(255),
  packageHash: z.string().regex(/^[a-f0-9]{64}$/u),
  scope: pluginJobOwnerScopeSchema,
  libraryId: z.string().min(1).max(255).nullable(),
});
export type PluginJobOwner = z.infer<typeof pluginJobOwnerSchema>;

export const pluginJobExecutionAvailabilitySchema = z.enum(['ready', 'blocked']);
export type PluginJobExecutionAvailability = z.infer<typeof pluginJobExecutionAvailabilitySchema>;

export const pluginJobProgressSchema = z.strictObject({
  completed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  phase: z.string().max(128),
  message: z.string().max(1_024),
  /** A projection for existing consumers; it is never the source of truth. */
  progress: z.number().min(0).max(1),
}).superRefine((value, context) => {
  if (value.completed > value.total) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['completed'], message: 'completed cannot exceed total.' });
  }
});
export type PluginJobProgress = z.infer<typeof pluginJobProgressSchema>;

export const pluginJobItemResultStatusSchema = z.enum(['succeeded', 'failed', 'cancelled', 'skipped']);
export type PluginJobItemResultStatus = z.infer<typeof pluginJobItemResultStatusSchema>;

export const pluginJobItemResultSchema = z.strictObject({
  itemId: z.string().min(1).max(255),
  assetId: z.string().min(1).max(255).optional(),
  status: pluginJobItemResultStatusSchema,
  errorCode: z.string().min(1).max(128).optional(),
  errorDetail: z.string().max(4_096).optional(),
  retryInput: z.record(z.string(), z.unknown()).optional(),
});
export type PluginJobItemResult = z.infer<typeof pluginJobItemResultSchema>;

export const pluginJobCheckpointSchema = z.strictObject({
  version: z.string().min(1).max(64),
  cursor: z.string().max(4_096).optional(),
  data: z.record(z.string(), z.unknown()).default({}),
  savedAt: z.string().datetime(),
});
export type PluginJobCheckpoint = z.infer<typeof pluginJobCheckpointSchema>;

export const pluginJobHandlerCapabilitiesSchema = z.strictObject({
  handlerId: z.string().min(1).max(128),
  resumable: z.boolean(),
  checkpointVersion: z.string().min(1).max(64).optional(),
});
export type PluginJobHandlerCapabilities = z.infer<typeof pluginJobHandlerCapabilitiesSchema>;

export const pluginJobCancellationSchema = z.strictObject({
  requested: z.boolean(),
  reason: z.string().max(1_024).optional(),
});
export type PluginJobCancellation = z.infer<typeof pluginJobCancellationSchema>;

export const pluginJobControlActionSchema = z.enum(['pause', 'resume', 'cancel', 'retry']);
export type PluginJobControlAction = z.infer<typeof pluginJobControlActionSchema>;

export const pluginJobSignalActionSchema = z.enum(['pause', 'cancel']);
export type PluginJobSignalAction = z.infer<typeof pluginJobSignalActionSchema>;

export type PluginJobOwnerFields = Pick<PluginJobOwner,
  'pluginId' | 'packageHash' | 'pluginInstanceId' | 'scope' | 'libraryId'>;

export class PluginJobContractError extends Error {
  constructor(message: string, readonly code: 'NOT_RESUMABLE' | 'CHECKPOINT_REQUIRED' | 'INVALID_PROGRESS') {
    super(message);
    this.name = 'PluginJobContractError';
  }
}

export const pluginJobStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
]);
export type PluginJobStatus = z.infer<typeof pluginJobStatusSchema>;

// `interrupted` is a Host-owned terminal state. A plugin handler may only
// complete its own running invocation with a success, failure, or cancellation.
export const pluginJobTerminalStatusSchema = z.enum(['succeeded', 'failed', 'cancelled']);
export type PluginJobTerminalStatus = z.infer<typeof pluginJobTerminalStatusSchema>;

export const pluginJobRecordSchema = z.strictObject({
  jobId: z.string().uuid(),
  libraryId: z.string().min(1).max(255),
  kind: z.literal(PLUGIN_BACKGROUND_JOB_KIND),
  status: pluginJobStatusSchema,
  progress: z.number().min(0).max(1),
  attemptCount: z.number().int().nonnegative(),
  errorCode: z.string().min(1).max(128).nullable(),
  errorDetail: z.string().max(4_096).nullable(),
  ownerPluginId: z.string().min(1).max(255),
  ownerPackageHash: z.string().regex(/^[a-f0-9]{64}$/u),
  /** Optional while old rows are being read before a migration adds columns. */
  ownerPluginInstanceId: z.string().min(1).max(255).optional(),
  ownerScope: pluginJobOwnerScopeSchema.optional(),
  ownerLibraryId: z.string().min(1).max(255).nullable().optional(),
  executionAvailability: pluginJobExecutionAvailabilitySchema.optional(),
  pluginHandlerId: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown()).default({}),
  recoveryStrategy: pluginJobRecoveryStrategySchema,
  completed: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
  phase: z.string().max(128).optional(),
  message: z.string().max(1_024).optional(),
  itemResults: z.array(pluginJobItemResultSchema).max(100_000).optional(),
  failedAssetIds: z.array(z.string().min(1).max(255)).max(100_000).optional(),
  retryInput: z.record(z.string(), z.unknown()).optional(),
  checkpoint: pluginJobCheckpointSchema.optional(),
  cancellation: pluginJobCancellationSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PluginJobRecord = z.infer<typeof pluginJobRecordSchema>;

export const pluginJobCompleteSchema = z.strictObject({
  jobId: z.string().uuid(),
  status: pluginJobTerminalStatusSchema,
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
});
export type PluginJobComplete = z.infer<typeof pluginJobCompleteSchema>;

export const PLUGIN_JOB_PAYLOAD_MAX_BYTES = 64 * 1024;

export type PluginJobProgressInput = Pick<PluginJobProgress, 'completed' | 'total' | 'phase' | 'message'> & {
  progress?: number;
};

/**
 * Compute the display projection from counters. The counters are authoritative;
 * `progress` is retained only for old consumers and zero-total jobs.
 */
export function projectPluginJobProgress(input: Pick<PluginJobProgressInput, 'completed' | 'total'> & { progress?: number }): number {
  if (input.total > 0) return Math.min(1, input.completed / input.total);
  return input.progress ?? 0;
}

export function applyPluginJobProgress(
  previous: Pick<PluginJobProgress, 'completed' | 'total' | 'phase' | 'message' | 'progress'> | undefined,
  next: PluginJobProgressInput,
): PluginJobProgress {
  if (next.completed > next.total) {
    throw new PluginJobContractError('completed cannot exceed total.', 'INVALID_PROGRESS');
  }
  if (previous !== undefined && (next.completed < previous.completed || next.total < previous.total)) {
    throw new PluginJobContractError('Job progress counters cannot move backwards.', 'INVALID_PROGRESS');
  }
  const progress = projectPluginJobProgress(next);
  if (previous !== undefined && progress < previous.progress) {
    throw new PluginJobContractError('Projected job progress cannot move backwards.', 'INVALID_PROGRESS');
  }
  return { ...next, progress };
}

export function assertPluginJobControlAllowed(
  action: 'pause' | 'resume',
  capabilities: PluginJobHandlerCapabilities,
  checkpoint: PluginJobCheckpoint | undefined,
): void {
  if (!capabilities.resumable) {
    throw new PluginJobContractError(
      `Handler ${capabilities.handlerId} does not declare resumable checkpoint support.`,
      'NOT_RESUMABLE',
    );
  }
  if (checkpoint === undefined || capabilities.checkpointVersion === undefined
    || checkpoint.version !== capabilities.checkpointVersion) {
    throw new PluginJobContractError(
      `${action} requires a checkpoint matching the handler declaration.`,
      'CHECKPOINT_REQUIRED',
    );
  }
}

export function pluginJobOwnerMatches(
  job: Pick<PluginJobRecord, 'ownerPluginId' | 'ownerPackageHash' | 'ownerPluginInstanceId' | 'ownerScope' | 'ownerLibraryId' | 'libraryId'>,
  owner: PluginJobOwnerFields,
): boolean {
  return job.ownerPluginId === owner.pluginId
    && job.ownerPackageHash === owner.packageHash
    && job.ownerPluginInstanceId === owner.pluginInstanceId
    && job.ownerScope === owner.scope
    && job.ownerLibraryId === owner.libraryId
    && job.libraryId === owner.libraryId;
}

export function throwIfPluginJobAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('The plugin job was cancelled.', 'AbortError');
  }
}

export function createPluginJobCancellationController(): {
  signal: AbortSignal;
  cancel(reason?: string): void;
} {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    cancel(reason?: string): void {
      controller.abort(reason);
    },
  };
}

export function serializePluginJobPayload(payload: unknown): string {
  const json = JSON.stringify(payload ?? {});
  if (Buffer.byteLength(json, 'utf8') > PLUGIN_JOB_PAYLOAD_MAX_BYTES) {
    throw new Error(`Plugin job payload exceeds ${PLUGIN_JOB_PAYLOAD_MAX_BYTES} bytes.`);
  }
  return json;
}

export function parsePluginJobPayload(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Bounded queue for Host → guest job invokes. Waiters receive null on close so
 * `jobs.__nextJob` can exit during deactivate.
 */
export function createPluginJobInvokeQueue(options?: {
  maxBuffered?: number;
}): {
  push(job: PluginJobRecord): void;
  next(): Promise<PluginJobRecord | null>;
  close(): void;
} {
  const maxBuffered = options?.maxBuffered ?? 16;
  const buffered: PluginJobRecord[] = [];
  const waiters: Array<(value: PluginJobRecord | null) => void> = [];
  let closed = false;

  return {
    push(job: PluginJobRecord): void {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter(job);
        return;
      }
      if (buffered.length >= maxBuffered) {
        buffered.shift();
      }
      buffered.push(job);
    },
    next(): Promise<PluginJobRecord | null> {
      if (closed) return Promise.resolve(null);
      const bufferedJob = buffered.shift();
      if (bufferedJob !== undefined) return Promise.resolve(bufferedJob);
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close(): void {
      if (closed) return;
      closed = true;
      buffered.length = 0;
      while (waiters.length > 0) {
        waiters.shift()?.(null);
      }
    },
  };
}
