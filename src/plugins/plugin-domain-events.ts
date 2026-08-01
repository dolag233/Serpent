import { z } from 'zod';

/**
 * Phase D domain events delivered to active Plugin Hosts after facts commit.
 * Payloads stay transport-safe: no absolute paths or secrets.
 */

export const PLUGIN_CAUSE_CHAIN_MAX_DEPTH = 8;

export const pluginDomainEventKindSchema = z.enum([
  'library.changed',
  'asset.changed',
]);
export type PluginDomainEventKind = z.infer<typeof pluginDomainEventKindSchema>;

export const pluginCauseChainSchema = z
  .array(z.string().uuid())
  .max(PLUGIN_CAUSE_CHAIN_MAX_DEPTH)
  .default([]);
export type PluginCauseChain = z.infer<typeof pluginCauseChainSchema>;

export const pluginDomainEventSchema = z.strictObject({
  eventId: z.string().uuid(),
  kind: pluginDomainEventKindSchema,
  libraryId: z.string().min(1).max(255),
  occurredAt: z.string().datetime(),
  causeChain: pluginCauseChainSchema,
  summary: z.record(z.string(), z.unknown()).default({}),
});
export type PluginDomainEvent = z.infer<typeof pluginDomainEventSchema>;

export type CauseChainValidation =
  | { ok: true; causeChain: string[] }
  | { ok: false; code: 'CAUSE_CHAIN_TOO_DEEP' | 'CAUSE_CHAIN_CYCLE'; message: string };

export function validatePluginCauseChain(input: unknown): CauseChainValidation {
  const parsed = pluginCauseChainSchema.safeParse(input ?? []);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'CAUSE_CHAIN_TOO_DEEP',
      message: `Cause chain must be at most ${PLUGIN_CAUSE_CHAIN_MAX_DEPTH} event ids.`,
    };
  }
  const causeChain = parsed.data;
  if (causeChain.length > PLUGIN_CAUSE_CHAIN_MAX_DEPTH) {
    return {
      ok: false,
      code: 'CAUSE_CHAIN_TOO_DEEP',
      message: `Cause chain exceeded depth ${PLUGIN_CAUSE_CHAIN_MAX_DEPTH}.`,
    };
  }
  const seen = new Set<string>();
  for (const eventId of causeChain) {
    if (seen.has(eventId)) {
      return {
        ok: false,
        code: 'CAUSE_CHAIN_CYCLE',
        message: 'Cause chain repeats an event id and would form a feedback loop.',
      };
    }
    seen.add(eventId);
  }
  return { ok: true, causeChain };
}

export function appendCauseChain(
  existing: readonly string[],
  eventId: string,
): CauseChainValidation {
  return validatePluginCauseChain([...existing, eventId]);
}

export function createPluginDomainEvent(input: {
  eventId?: string;
  kind: PluginDomainEventKind;
  libraryId: string;
  occurredAt?: string;
  causeChain?: readonly string[];
  summary?: Record<string, unknown>;
}): PluginDomainEvent {
  return pluginDomainEventSchema.parse({
    eventId: input.eventId ?? globalThis.crypto.randomUUID(),
    kind: input.kind,
    libraryId: input.libraryId,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    causeChain: [...(input.causeChain ?? [])],
    summary: input.summary ?? {},
  });
}

/**
 * Bounded in-process queue used by Plugin Hosts. Waiters receive null on close
 * so `events.next()` can exit cleanly during deactivate.
 */
export function createPluginDomainEventQueue(options?: {
  maxBuffered?: number;
}): {
  push(event: PluginDomainEvent): void;
  next(): Promise<PluginDomainEvent | null>;
  close(): void;
  size(): number;
} {
  const maxBuffered = options?.maxBuffered ?? 64;
  const buffered: PluginDomainEvent[] = [];
  const waiters: Array<(value: PluginDomainEvent | null) => void> = [];
  let closed = false;

  return {
    push(event: PluginDomainEvent): void {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter !== undefined) {
        waiter(event);
        return;
      }
      if (buffered.length >= maxBuffered) {
        buffered.shift();
      }
      buffered.push(event);
    },
    next(): Promise<PluginDomainEvent | null> {
      if (closed) return Promise.resolve(null);
      const bufferedEvent = buffered.shift();
      if (bufferedEvent !== undefined) return Promise.resolve(bufferedEvent);
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
    size(): number {
      return buffered.length;
    },
  };
}
