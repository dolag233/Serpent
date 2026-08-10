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
  planHash: string | null;
  expiresAt: string;
};

/** Confirmation fields the agent repeats the SAME tool call with. */
export const MCP_CHALLENGE_CONFIRMATION_FIELDS = [
  'challengeId',
  'planHash',
  'acknowledged',
  'idempotencyKey',
] as const;

export function hasMcpChallengeConfirmation(input: unknown): boolean {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const record = input as Record<string, unknown>;
  return typeof record.challengeId === 'string' && record.challengeId.length > 0
    && record.acknowledged === true;
}

/** Strip confirmation fields before schema parsing / worker dispatch. */
export function stripMcpChallengeConfirmationFields(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  const record = { ...(input as Record<string, unknown>) };
  for (const field of MCP_CHALLENGE_CONFIRMATION_FIELDS) delete record[field];
  return record;
}
