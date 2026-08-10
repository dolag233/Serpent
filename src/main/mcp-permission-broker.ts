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
import type { McpPermissionPolicyStore } from './mcp-permission-policy-store';

export interface McpPermissionBrokerOptions {
  policyStore: McpPermissionPolicyStore;
  audit?: {
    info(scope: string, message: string, context?: Record<string, unknown>): void;
  };
}

/**
 * Resolves credential-level MCP access without waiting for Desktop input.
 *
 * Auto is deliberately permissive for ordinary and recoverable commands. A
 * dangerous command must implement its own agent-facing two-phase challenge;
 * it must never turn this broker into a per-call human prompt.
 */
export class McpPermissionBroker implements AutomationPermissionBroker {
  readonly #policyStore: McpPermissionPolicyStore;
  readonly #audit: McpPermissionBrokerOptions['audit'];

  public constructor(options: McpPermissionBrokerOptions) {
    this.#policyStore = options.policyStore;
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

  public clearExecution(): void {
    // No permission is stored in a transport session.
  }

  public clearCredential(): void {
    // Persistent mode is cleared by McpPermissionPolicyStore on revoke.
  }

  public clearCapability(): void {
    // Capability policy is no longer a runtime grant cache.
  }
}
