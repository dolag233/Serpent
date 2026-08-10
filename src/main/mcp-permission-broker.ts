import {
  getAutomationCommandPermissionMetadata,
  type AutomationCommandDescriptor,
} from '../automation/command-registry';
import type {
  AutomationExecutionContext,
  AutomationPermissionAuthorization,
  AutomationPermissionBroker,
  AutomationPermissionPlanSummary,
} from '../automation/command-gateway';
import {
  hasMcpChallengeConfirmation,
  stripMcpChallengeConfirmationFields,
  type McpDangerousOperationChallenge,
} from '../automation/mcp-challenge';
import type { McpPermissionPolicyStore } from './mcp-permission-policy-store';
import type { McpOperationChallengeStore } from './mcp-operation-challenge';

export interface McpPermissionBrokerOptions {
  policyStore: McpPermissionPolicyStore;
  /** Single-use store for dangerous two-phase challenges. */
  challengeStore: McpOperationChallengeStore;
  /**
   * Desktop confirmation for writes that are outside the credential's
   * profile (a read-only credential attempting a write). The MCP call
   * waits for the user's decision; an absent handler denies immediately.
   */
  confirmOutOfScope?: (input: {
    credentialId: string;
    clientName?: string;
    commandId: string;
    summary: string;
    targetCount: number;
  }) => Promise<boolean>;
  audit?: {
    info(scope: string, message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Resolves credential-profile MCP access without transport-session state.
 *
 * Profiles: read-only (writes need a desktop confirmation), read-write
 * (ordinary writes direct, dangerous ops need the two-phase challenge),
 * full-access (everything direct — the user accepted the responsibility when
 * enabling it).
 */
export class McpPermissionBroker implements AutomationPermissionBroker {
  readonly #policyStore: McpPermissionPolicyStore;
  readonly #challengeStore: McpOperationChallengeStore;
  readonly #confirmOutOfScope: McpPermissionBrokerOptions['confirmOutOfScope'];
  readonly #audit: McpPermissionBrokerOptions['audit'];

  public constructor(options: McpPermissionBrokerOptions) {
    this.#policyStore = options.policyStore;
    this.#challengeStore = options.challengeStore;
    this.#confirmOutOfScope = options.confirmOutOfScope;
    this.#audit = options.audit;
  }

  public async authorize(input: {
    context: AutomationExecutionContext;
    descriptor: AutomationCommandDescriptor;
    commandInput: unknown;
    planSummary?: AutomationPermissionPlanSummary;
    signal?: AbortSignal;
  }): Promise<AutomationPermissionAuthorization> {
    const { context, descriptor } = input;
    if (input.signal?.aborted || context.abortSignal?.aborted) {
      return { allowed: false, reason: 'cancelled' };
    }
    const credentialId = context.clientCredentialId;
    if (credentialId === undefined) {
      return { allowed: false, reason: 'denied' };
    }
    const mode = this.#policyStore.getMode(credentialId);

    // Dangerous operations: full-access runs them directly (the user accepted
    // the responsibility); every other profile still needs the two-phase
    // agent challenge.
    if (descriptor.criticalOperation === true) {
      if (mode === 'full-access') {
        this.#audit?.info(
          'mcp.permission.full-access-critical',
          'Dangerous MCP operation executed under the full-access profile.',
          { credentialId, commandId: descriptor.commandId },
        );
        return { allowed: true, scope: 'always-allow' };
      }
      return this.authorizeCritical(input);
    }

    // Serpent-8b5b.8 review: the read-only gate applies to EVERY write,
    // including allow-policy writes (e.g. library.create) that have no
    // askable capabilities and would otherwise short-circuit below.
    if (mode === 'read-only' && descriptor.impact !== 'read') {
      const targetCount = this.deriveTargets(input.commandInput).length;
      if (this.#confirmOutOfScope !== undefined) {
        const approved = await this.#confirmOutOfScope({
          credentialId,
          clientName: context.clientName,
          commandId: descriptor.commandId,
          summary: descriptor.summary,
          targetCount,
        });
        if (approved) {
          this.#audit?.info(
            'mcp.permission.out-of-scope-approved',
            'A write outside the read-only profile was approved by the desktop user.',
            { credentialId, commandId: descriptor.commandId, targetCount },
          );
          return { allowed: true, scope: 'already-granted' };
        }
      }
      this.#audit?.info(
        'mcp.permission.out-of-scope-denied',
        'A write outside the read-only profile was denied.',
        { credentialId, commandId: descriptor.commandId, targetCount },
      );
      return { allowed: false, reason: 'denied' };
    }

    const requested = getAutomationCommandPermissionMetadata(descriptor).requestableCapabilities;
    this.#audit?.info('mcp.permission.auto', 'MCP capability allowed without a human prompt.', {
      credentialId,
      commandId: descriptor.commandId,
      mode,
      capabilities: [...requested],
      ...(input.planSummary === undefined ? {} : {
        planOperation: input.planSummary.operation,
        planTargetCount: input.planSummary.targetCount,
      }),
    });
    return {
      allowed: true,
      scope: mode === 'full-access' ? 'always-allow' : 'already-granted',
    };
  }

  /** Dangerous commands: first call issues a challenge; second exact call consumes it. */
  private authorizeCritical(input: {
    context: AutomationExecutionContext;
    descriptor: AutomationCommandDescriptor;
    commandInput: unknown;
  }): AutomationPermissionAuthorization {
    const { context, descriptor } = input;
    const credentialId = context.clientCredentialId;
    if (credentialId === undefined) {
      return { allowed: false, reason: 'denied' };
    }
    const canonicalInput = stripMcpChallengeConfirmationFields(input.commandInput);
    const targets = this.deriveTargets(canonicalInput);
    const binding = {
      credentialId,
      commandId: descriptor.commandId,
      canonicalInput,
      libraryId: context.libraryId,
      contextRevision: context.contextRevision ?? null,
    };
    const issue = (): McpDangerousOperationChallenge => this.#challengeStore.issue({
      operation: descriptor.commandId,
      summary: descriptor.summary,
      irreversibleEffects: [descriptor.summary],
      targets,
      recovery: descriptor.impact === 'destructive' ? 'none' : 'partial',
      planHash: null,
      ...binding,
    });
    if (hasMcpChallengeConfirmation(input.commandInput)) {
      const raw = input.commandInput as Record<string, unknown>;
      const consumed = this.#challengeStore.consume({
        challengeId: String(raw.challengeId),
        planHash: typeof raw.planHash === 'string' ? raw.planHash : null,
        ...binding,
      });
      if (consumed.status === 'ok') {
        this.#audit?.info(
          'mcp.permission.challenge-confirmed',
          'Dangerous MCP operation confirmed by an exact two-phase challenge.',
          { credentialId, commandId: descriptor.commandId, targetCount: targets.length },
        );
        return { allowed: true, scope: 'challenge-confirmed', challengeConsumed: true };
      }
      this.#audit?.info(
        'mcp.permission.challenge-rejected',
        `Dangerous MCP confirmation rejected (${consumed.status}); a fresh risk report was issued.`,
        { credentialId, commandId: descriptor.commandId, targetCount: targets.length },
      );
      return { allowed: false, reason: 'challenge-required', challenge: issue() };
    }
    this.#audit?.info(
      'mcp.permission.challenge-issued',
      'Dangerous MCP operation issued a two-phase challenge; nothing executed.',
      { credentialId, commandId: descriptor.commandId, targetCount: targets.length },
    );
    return { allowed: false, reason: 'challenge-required', challenge: issue() };
  }

  private deriveTargets(commandInput: unknown): Array<{ id: string }> {
    if (commandInput === null || typeof commandInput !== 'object') return [];
    const record = commandInput as Record<string, unknown>;
    if (Array.isArray(record.assetIds)) {
      return (record.assetIds as unknown[])
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ id }));
    }
    if (typeof record.libraryId === 'string') return [{ id: record.libraryId }];
    return [];
  }

  public clearExecution(): void {
    // No permission is stored in a transport session.
  }

  public clearCredential(): void {
    // Persistent profile is cleared by McpPermissionPolicyStore on revoke.
  }

  /** Drop outstanding challenges for a credential (revocation). */
  public clearCredentialChallenges(credentialId: string): void {
    this.#challengeStore.clearCredential(credentialId);
  }

  /** Drop all outstanding challenges (server stop). */
  public clearAllChallenges(): void {
    this.#challengeStore.clearAll();
  }

  public clearCapability(): void {
    // Capability policy is no longer a runtime grant cache.
  }
}
