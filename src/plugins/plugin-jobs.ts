import { z } from 'zod';

/** Fixed jobs.kind for all plugin-owned background work. */
export const PLUGIN_BACKGROUND_JOB_KIND = 'plugin.background' as const;

export const PLUGIN_JOB_DEFAULT_TIMEOUT_MS = 120_000;

export const pluginJobRecoveryStrategySchema = z.enum(['idempotent', 'checkpoint']);
export type PluginJobRecoveryStrategy = z.infer<typeof pluginJobRecoveryStrategySchema>;

export const pluginJobStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'succeeded',
  'failed',
  'cancelled',
]);
export type PluginJobStatus = z.infer<typeof pluginJobStatusSchema>;

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
  pluginHandlerId: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown()).default({}),
  recoveryStrategy: pluginJobRecoveryStrategySchema,
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
});
export type PluginJobComplete = z.infer<typeof pluginJobCompleteSchema>;

export const PLUGIN_JOB_PAYLOAD_MAX_BYTES = 64 * 1024;

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
