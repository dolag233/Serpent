import { createHash, randomUUID } from 'node:crypto';

import type { McpDangerousOperationChallenge } from '../automation/mcp-challenge';

/**
 * Two-phase confirmation for dangerous MCP operations (Serpent-8b5b.2,
 * ADR-0031 §5.3).
 *
 * The first call to a dangerous tool never executes: it issues a short-lived,
 * single-use challenge bound to the credential, command, canonicalized input,
 * targets, library and (when known) the library context revision. The agent
 * repeats the same tool call with the challenge id and plan hash; only an
 * exact, unexpired, unconsumed binding is accepted, and it is consumed exactly
 * once. Precondition changes (context revision moved) produce a fresh risk
 * report instead of executing.
 *
 * The store is deliberately in-memory: challenges are per-process confirmations
 * with a short TTL. A server restart invalidates outstanding challenges, which
 * is safe — the dangerous operation never executed.
 */

export const MCP_CHALLENGE_TTL_MS = 10 * 60 * 1000;

export type McpChallengeConsumeResult =
  | { status: 'ok' }
  | { status: 'expired' }
  | { status: 'already-consumed' }
  | { status: 'tampered' }
  | { status: 'cross-client' }
  | { status: 'state-changed' };

type McpOperationChallengeRecord = {
  challengeId: string;
  credentialId: string;
  commandId: string;
  /** SHA-256 of the canonicalized input with confirmation fields stripped. */
  inputHash: string;
  libraryId: string | null;
  contextRevision: number | null;
  planHash: string | null;
  expiresAt: string;
  consumedAt: string | null;
};

export type McpChallengeIssueInput = {
  credentialId: string;
  commandId: string;
  operation: string;
  summary: string;
  irreversibleEffects: string[];
  targets: Array<{ id: string; displayName?: string }>;
  recovery: 'none' | 'partial';
  planHash: string | null;
  /** Canonicalized input with confirmation fields stripped (the hash to bind). */
  canonicalInput: unknown;
  libraryId: string | null;
  contextRevision: number | null;
  now?: Date;
};

export type McpChallengeConsumeInput = {
  challengeId: string;
  planHash: string | null;
  credentialId: string;
  commandId: string;
  canonicalInput: unknown;
  libraryId: string | null;
  contextRevision: number | null;
  now?: Date;
};

/** Stable canonical serialization so the same logical input always hashes alike. */
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

function inputHashOf(canonicalInput: unknown): string {
  return createHash('sha256').update(canonicalizeMcpToolInput(canonicalInput)).digest('hex');
}

export class McpOperationChallengeStore {
  readonly #records = new Map<string, McpOperationChallengeRecord>();

  /** Issue a new challenge bound to the exact call. */
  issue(input: McpChallengeIssueInput): McpDangerousOperationChallenge {
    const now = input.now ?? new Date();
    const challengeId = randomUUID();
    const expiresAt = new Date(now.getTime() + MCP_CHALLENGE_TTL_MS).toISOString();
    this.#records.set(challengeId, {
      challengeId,
      credentialId: input.credentialId,
      commandId: input.commandId,
      inputHash: inputHashOf(input.canonicalInput),
      libraryId: input.libraryId,
      contextRevision: input.contextRevision,
      planHash: input.planHash,
      expiresAt,
      consumedAt: null,
    });
    return {
      status: 'confirmation-required',
      challengeId,
      operation: input.operation,
      severity: 'dangerous',
      summary: input.summary,
      irreversibleEffects: input.irreversibleEffects,
      affectedTargets: input.targets,
      affectedCount: input.targets.length,
      recovery: input.recovery,
      planHash: input.planHash,
      expiresAt,
    };
  }

  /** Validate and single-use consume a challenge; never executes the operation. */
  consume(input: McpChallengeConsumeInput): McpChallengeConsumeResult {
    const now = (input.now ?? new Date()).getTime();
    const record = this.#records.get(input.challengeId);
    if (record === undefined) return { status: 'tampered' };
    if (record.consumedAt !== null) return { status: 'already-consumed' };
    if (Date.parse(record.expiresAt) <= now) {
      this.#records.delete(input.challengeId);
      return { status: 'expired' };
    }
    if (record.credentialId !== input.credentialId) return { status: 'cross-client' };
    if (record.commandId !== input.commandId) return { status: 'tampered' };
    if (record.libraryId !== input.libraryId) return { status: 'tampered' };
    if (record.planHash !== input.planHash) return { status: 'tampered' };
    if (record.inputHash !== inputHashOf(input.canonicalInput)) return { status: 'tampered' };
    if (record.contextRevision !== input.contextRevision) {
      // Both null (stateless sessions without a revision) matches; any
      // concrete mismatch — including one side null — means the library
      // context moved since the challenge was issued.
      if (record.contextRevision !== null || input.contextRevision !== null) {
        return { status: 'state-changed' };
      }
    }
    record.consumedAt = new Date(now).toISOString();
    return { status: 'ok' };
  }

  /** Remove all challenges for a credential (revocation / server stop). */
  clearCredential(credentialId: string): void {
    for (const [challengeId, record] of this.#records) {
      if (record.credentialId === credentialId) this.#records.delete(challengeId);
    }
  }

  /** Remove all challenges (server stop / full revoke). */
  clearAll(): void {
    this.#records.clear();
  }
}
