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
  /** Serpent-8b5b.2: single-use store for dangerous two-phase challenges. */
  challengeStore: McpOperationChallengeStore;
  audit?: {
    info(scope: string, message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Resolves credential-level MCP access without waiting for Desktop input.
 *
 * Auto is deliberately permissive for ordinary and recoverable commands.
 * Dangerous (critical) commands never execute on the first call: the broker
 * issues a short-lived challenge bound to the exact call and only consumes it
 * on the agent's second, exact call — never a per-call human prompt.
 */
export class McpPermissionBroker implements AutomationPermissionBroker {
  readonly #policyStore: McpPermissionPolicyStore;
  readonly #challengeStore: McpOperationChallengeStore;
  readonly #audit: McpPermissionBrokerOptions['audit'];

  public constructor(options: McpPermissionBrokerOptions) {
    this.#policyStore = options.policyStore;
    this.#challengeStore = options.challengeStore;
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
    if (descriptor.criticalOperation === true) {
      return this.authorizeCritical(input);
    }
    const requested = getAutomationCommandPermissionMetadata(descriptor).requestableCapabilities;
    if (requested.length === 0) {
      return { allowed: true, scope: 'already-granted' };
    }
    const credentialId = context.clientCredentialId;
    if (credentialId === undefined) {
      return { allowed: false, reason: 'denied' };
    }
    const mode = this.#policyStore.getMode(credentialId);
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

  private deriveTargets(canonicalInput: unknown): Array<{ id: string }> {
    if (canonicalInput === null || typeof canonicalInput !== 'object') return [];
    const record = canonicalInput as Record<string, unknown>;
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
    // Persistent mode is cleared by McpPermissionPolicyStore on revoke;
    // outstanding challenges are cleared via clearCredentialChallenges.
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
