import { z } from 'zod';

import { pluginCauseChainSchema } from './plugin-domain-events';

/**
 * Phase D blocking onWill hooks. Decisions run during Execution Plan preflight,
 * never inside SQLite write transactions or filesystem critical sections.
 */

export const PLUGIN_HOOK_DEFAULT_TIMEOUT_MS = 2_000;

/** First-ship events; expand as more plan-gated commands gain hook coverage. */
export const pluginHookEventSchema = z.enum(['asset.trash']);
export type PluginHookEvent = z.infer<typeof pluginHookEventSchema>;

export const pluginHookDecisionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('allow') }),
  z.strictObject({
    action: z.literal('warn'),
    message: z.string().min(1).max(512),
  }),
  z.strictObject({
    action: z.literal('block'),
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(512),
  }),
]);
export type PluginHookDecision = z.infer<typeof pluginHookDecisionSchema>;

export const pluginHookContextSchema = z.strictObject({
  event: pluginHookEventSchema,
  libraryId: z.string().min(1).max(255),
  summary: z.record(z.string(), z.unknown()).default({}),
  causeChain: pluginCauseChainSchema,
});
export type PluginHookContext = z.infer<typeof pluginHookContextSchema>;

export const pluginHookInvokeSchema = z.strictObject({
  invokeId: z.string().uuid(),
  event: pluginHookEventSchema,
  context: pluginHookContextSchema,
});
export type PluginHookInvoke = z.infer<typeof pluginHookInvokeSchema>;

export function normalizePluginHookDecision(raw: unknown): PluginHookDecision {
  const parsed = pluginHookDecisionSchema.safeParse(raw);
  if (!parsed.success) return { action: 'allow' };
  return parsed.data;
}

export type PluginHookDecisionEntry = {
  pluginId: string;
  blockingDeclared: boolean;
  hasBlockingPermission: boolean;
  decision: PluginHookDecision;
  timedOut: boolean;
};

export type AggregatedPluginHookResult =
  | { outcome: 'allow'; warnings: string[] }
  | {
    outcome: 'block';
    warnings: string[];
    block: { pluginId: string; code: string; message: string };
  };

/**
 * Stable order: pluginId ascending. First authorized block wins; timeouts are
 * fail-open. Block without `hook.blocking` permission is ignored.
 */
export function aggregatePluginHookDecisions(
  entries: readonly PluginHookDecisionEntry[],
): AggregatedPluginHookResult {
  const ordered = [...entries].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  const warnings: string[] = [];
  for (const entry of ordered) {
    if (entry.timedOut) continue;
    if (entry.decision.action === 'warn') {
      warnings.push(`[${entry.pluginId}] ${entry.decision.message}`);
      continue;
    }
    if (entry.decision.action !== 'block') continue;
    if (!entry.blockingDeclared || !entry.hasBlockingPermission) continue;
    return {
      outcome: 'block',
      warnings,
      block: {
        pluginId: entry.pluginId,
        code: entry.decision.code,
        message: entry.decision.message,
      },
    };
  }
  return { outcome: 'allow', warnings };
}

export class PluginHookBlockedError extends Error {
  readonly publicCode = 'PLUGIN_HOOK_BLOCKED' as const;
  readonly pluginId: string;
  readonly hookCode: string;

  constructor(input: { pluginId: string; hookCode: string; message: string }) {
    super(input.message);
    this.name = 'PluginHookBlockedError';
    this.pluginId = input.pluginId;
    this.hookCode = input.hookCode;
  }
}

/**
 * Bounded queue for Host → guest hook invokes. Waiters receive null on close so
 * `hooks.__nextInvoke` can exit during deactivate.
 */
export function createPluginHookInvokeQueue(options?: {
  maxBuffered?: number;
}): {
  push(invoke: PluginHookInvoke): void;
  next(): Promise<PluginHookInvoke | null>;
  close(): void;
} {
  const maxBuffered = options?.maxBuffered ?? 16;
  const buffered: PluginHookInvoke[] = [];
  const waiters: Array<(value: PluginHookInvoke | null) => void> = [];
  let closed = false;

  return {
    push(invoke: PluginHookInvoke): void {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter(invoke);
        return;
      }
      if (buffered.length >= maxBuffered) {
        buffered.shift();
      }
      buffered.push(invoke);
    },
    next(): Promise<PluginHookInvoke | null> {
      if (closed) return Promise.resolve(null);
      const bufferedInvoke = buffered.shift();
      if (bufferedInvoke !== undefined) return Promise.resolve(bufferedInvoke);
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
