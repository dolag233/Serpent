import { createHash } from 'node:crypto';

/**
 * Two-phase challenge contract for dangerous MCP operations (Serpent-8b5b.2,
 * ADR-0031 §5.3). Transport-neutral: the gateway issues/consumes challenges,
 * the MCP adapter maps them onto tool results, and Desktop Console/Scripts can
 * never reach critical operations (they are MCP-only by registry declaration).
 */

export type McpDangerousOperationChallenge = {
  status: 'confirmation-required';
  challengeId: string;
  operation: string;
  severity: 'dangerous';
  summary: string;
  irreversibleEffects: string[];
  affectedTargets: Array<{ id: string; displayName?: string }>;
  affectedCount: number;
  recovery: 'none' | 'partial';
  planHash: string;
  expiresAt: string;
};

/** Confirmation fields the agent repeats the SAME tool call with. */
export const MCP_CHALLENGE_CONFIRMATION_FIELDS = [
  'challengeId',
  'planHash',
  'acknowledged',
  'idempotencyKey',
] as const;

export type McpChallengePlanBinding = {
  commandId: string;
  canonicalInput: unknown;
  targetIds: readonly string[];
  libraryId: string | null;
  contextRevision: number | null;
  idempotencyKey: string;
};

/** Stable canonical serialization for challenge and plan bindings. */
export function canonicalizeMcpToolInput(value: unknown): string {
  const seen = new Set<unknown>();
  const normalize = (entry: unknown): unknown => {
    if (entry === null || typeof entry !== 'object') return entry;
    if (seen.has(entry)) return '[circular]';
    seen.add(entry);
    if (Array.isArray(entry)) return entry.map(normalize);
    const record = entry as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = normalize(record[key]);
      return acc;
    }, {});
  };
  return JSON.stringify(normalize(value));
}

/** Computes the non-empty SHA-256 plan identity bound to every challenge input. */
export function createMcpChallengePlanHash(binding: McpChallengePlanBinding): string {
  return createHash('sha256')
    .update(canonicalizeMcpToolInput({
      version: 1,
      commandId: binding.commandId,
      canonicalInput: binding.canonicalInput,
      targetIds: binding.targetIds,
      libraryId: binding.libraryId,
      contextRevision: binding.contextRevision,
      idempotencyKey: binding.idempotencyKey,
    }))
    .digest('hex');
}

function nonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function hasMcpChallengeConfirmation(input: unknown): boolean {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return nonBlankString(record.challengeId)
    && nonBlankString(record.planHash)
    && record.acknowledged === true
    && nonBlankString(record.idempotencyKey);
}

/** Returns the caller's operation key without treating it as a confirmation. */
export function getMcpChallengeIdempotencyKey(input: unknown): string | undefined {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const value = (input as Record<string, unknown>).idempotencyKey;
  return nonBlankString(value) ? value : undefined;
}

/** Strip confirmation fields before schema parsing / worker dispatch. */
export function stripMcpChallengeConfirmationFields(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  for (const field of MCP_CHALLENGE_CONFIRMATION_FIELDS) delete record[field];
  return record;
}
