import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  AUTOMATION_API_VERSION,
  automationCapabilitySchema,
  automationSourceSchema,
  getAutomationCommandPermissionMetadata,
  getAutomationCommandDescriptor,
  type AutomationCapability,
  type AutomationCommandId,
  type AutomationCommandInput,
  type AutomationCommandResult,
  type AutomationFileOperationPlanProof,
  type AutomationSource,
  type AutomationCommandDescriptor,
} from './command-registry';
import type { PublicError } from '../shared/protocol/errors';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import {
  createAutomationGatewayError,
  type AutomationGatewayError,
  type AutomationGatewayErrorCode,
} from '../shared/automation-host-command-error';
import { PluginHookBlockedError } from '../plugins/plugin-hooks';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';
import {
  stripMcpChallengeConfirmationFields,
  type McpDangerousOperationChallenge,
} from './mcp-challenge';
import type { AutomationIdempotencyStore } from '../main/automation-idempotency-store';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});
const idempotencyKeySchema = nonBlankString.max(128);

export const automationExecutionContextSchema = z.strictObject({
  executionId: nonBlankString.max(255),
  source: automationSourceSchema,
  clientCredentialId: nonBlankString.max(255).optional(),
  clientName: nonBlankString.max(128).optional(),
  libraryId: nonBlankString.max(255).nullable(),
  activeLibrary: z.strictObject({
    libraryId: nonBlankString.max(255),
    displayName: nonBlankString.max(255).optional(),
  }).nullable().optional(),
  contextRevision: z.number().int().nonnegative().optional(),
  authorizedLibraryIds: z.array(nonBlankString.max(255)).max(64).optional(),
  hostCapabilities: z.array(z.enum(['desktop-ui'])).max(16).optional(),
  grantedCapabilities: z.array(automationCapabilitySchema).max(64),
  logId: nonBlankString.max(255).optional(),
  deadlineAt: z.string().datetime().optional(),
  resourceBudget: z.strictObject({
    maxWallTimeMs: z.number().int().positive(),
    maxCpuTimeMs: z.number().int().positive(),
    maxMemoryBytes: z.number().int().positive(),
    maxOutputBytes: z.number().int().positive(),
    maxConcurrentCommands: z.number().int().positive(),
    maxPendingPromises: z.number().int().positive(),
  }).optional(),
  abortSignal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
});

export type AutomationExecutionContext = z.infer<typeof automationExecutionContextSchema>;

export const automationCommandEnvelopeSchema = z.strictObject({
  apiVersion: z.number().int().positive(),
  commandId: nonBlankString.max(255),
  executionId: nonBlankString.max(255),
  input: z.unknown(),
});

export type AutomationCommandEnvelope = z.infer<typeof automationCommandEnvelopeSchema>;

export type AutomationGatewayFailure = {
  ok: false;
  error: PublicError | AutomationGatewayError;
};

export type AutomationGatewaySuccess<Id extends AutomationCommandId = AutomationCommandId> = {
  ok: true;
  apiVersion: typeof AUTOMATION_API_VERSION;
  commandId: Id;
  executionId: string;
  result: AutomationCommandResult<Id>;
  /** Worker-owned durable history receipt; recipes never cross this boundary. */
  historyEntryId?: string;
  /** @deprecated Legacy automation journal projection; new commands use historyEntryId. */
  undoGroupId?: string;
};

/** Serpent-8b5b.2: a dangerous call answered with a two-phase challenge instead of executing. */
export type AutomationGatewayChallengeOutcome = {
  ok: false;
  challenge: McpDangerousOperationChallenge;
};

export type AutomationGatewayResult = AutomationGatewaySuccess | AutomationGatewayFailure | AutomationGatewayChallengeOutcome;

/**
 * Deliberately narrower than LibraryWorkerClient. This prevents Gateway and
 * future Script/MCP adapters from reaching LibraryService, filesystem, SQL or
 * worker lifecycle operations directly.
 */
export interface AutomationWorkerClient {
  request(
    command: WorkerCommand,
    options?: {
      signal?: AbortSignal;
      readonly?: boolean;
      historyContext?: {
        source: 'desktop' | 'script' | 'mcp' | 'plugin';
        sourceReference?: string | null;
        historyGroupId?: string;
      };
    },
  ): Promise<WorkerResult>;
}

/**
 * Execution context is Main-owned state. Adapters must never trust a script
 * or MCP payload to choose a library, client source, or capability grant.
 */
export interface AutomationExecutionResolver {
  resolve(executionId: string): AutomationExecutionContext | undefined | Promise<AutomationExecutionContext | undefined>;
}

/**
 * Execution history is observability, never part of command correctness. The
 * Gateway intentionally ignores audit-store failures after the command result
 * has been determined so an unavailable history file cannot turn a successful
 * library operation into an apparent failure.
 */
export interface AutomationExecutionAuditSink {
  recordCommandResult(
    executionId: string,
    commandId: string,
    outcome: 'succeeded' | 'failed',
    failureCode?: string,
  ): void | Promise<void>;
}

/**
 * Main injects AppLogger here. It is deliberately separate from the journal:
 * an unavailable execution-history file must never erase the diagnostic that
 * explains why history is incomplete.
 */
export interface AutomationGatewayAuditLogger {
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
}

/**
 * A deliberately narrow Main-owned hook for effects that must never cross the
 * renderer/script boundary, such as writing real filesystem paths to the OS
 * clipboard. The Worker result remains private to Main; the descriptor still
 * projects a path-free result for the script.
 */
export interface AutomationExternalEffectHandler {
  apply(input: {
    commandId: AutomationCommandId;
    executionId: string;
    libraryId: string;
    commandInput: unknown;
    workerResult: WorkerResult;
  }): void | Promise<void>;
}

/**
 * File writes are approved from a Main-owned, fresh Worker preview.  The
 * returned proof is opaque to scripts and is revalidated by the Worker just
 * before the filesystem operation.  Keeping the preview/approval boundary
 * here means a script can never forge a stale plan or suppress the desktop
 * confirmation.
 */
export interface AutomationFilePlanApprovalHandler {
  prepareAndApprove(input: {
    commandId: AutomationCommandId;
    executionId: string;
    libraryId: string | null;
    commandInput: unknown;
    source?: AutomationSource;
    clientName?: string;
    libraryDisplayName?: string;
    requestApproval?: (input: {
      commandId: AutomationCommandId;
      executionId: string;
      libraryId: string | null;
      commandInput: unknown;
      source: AutomationSource;
      clientName?: string;
      libraryDisplayName?: string;
      summary: AutomationPermissionPlanSummary;
    }) => Promise<boolean>;
  }): Promise<AutomationFileOperationPlanProof | undefined>;
}

export interface AutomationPermissionPlanSummary {
  operation: string;
  targetCount: number;
  executableCount: number;
  blockedCount: number;
  conflictCount?: number;
  undoSupported: boolean;
  hookWarnings?: readonly string[];
}

export type AutomationPermissionAuthorization =
  | { allowed: true; scope: 'allow-once' | 'allow-session' | 'always-allow' | 'already-granted' | 'challenge-confirmed'; challengeConsumed?: boolean }
  | { allowed: false; reason: 'denied' | 'cancelled' }
  | { allowed: false; reason: 'challenge-required'; challenge: McpDangerousOperationChallenge };

/** Main-owned policy and prompt boundary for MCP controlled capabilities. */
export interface AutomationPermissionBroker {
  authorize(input: {
    context: AutomationExecutionContext;
    descriptor: AutomationCommandDescriptor;
    commandInput: unknown;
    planSummary?: AutomationPermissionPlanSummary;
    signal?: AbortSignal;
  }): Promise<AutomationPermissionAuthorization>;
  clearExecution(executionId: string): void;
  clearCredential(credentialId: string): void;
  clearCapability(credentialId: string, capability: AutomationCapability): void;
}

export interface AutomationLibraryBindingHandler {
  onLibraryCreated?(input: {
    executionId: string;
    source: AutomationSource;
    library: { libraryId: string; displayName: string; libraryPath: string };
  }): void | Promise<void>;
  transitionLibraryContext?(input: {
    executionId: string;
    source?: AutomationSource;
    libraryId: string;
    displayName?: string;
    expectedRevision: number;
    authorizationSource: 'approved-plan' | 'context-confirmation';
  }): void | Promise<{ contextRevision?: number } | void>;
  /** Used by existing script/worker integration until all callers migrate. */
  bindLibrary?(input: { executionId: string; libraryId: string }): void | Promise<void>;
  onLibraryClosed?(input: { executionId: string; source: AutomationSource; libraryId: string }): void | Promise<void>;
  onLibraryRenamed?(input: { executionId: string; source: AutomationSource; library: { libraryId: string; displayName: string; libraryPath: string } }): void | Promise<void>;
  onLibraryDeleted?(input: { executionId: string; source: AutomationSource; libraryId: string; displayName: string; libraryPath: string }): void | Promise<void>;
  onLibraryImported?(input: { executionId: string; source: AutomationSource; libraryId: string; displayName: string; libraryPath: string }): void | Promise<void>;
}

export interface AutomationLibraryContextHandler {
  execute(input: {
    commandId: 'library.list-open' | 'library.list-recent' | 'library.open' | 'library.show-in-desktop';
    executionId: string;
    context: AutomationExecutionContext;
    commandInput: unknown;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export interface AutomationContextBarrier {
  beginCommand(executionId: string, contextRevision: number): { release: () => void };
}

/**
 * Main-owned journal read for `execution.status`. The Gateway never forwards
 * this command to the Worker; the handler must return a path-free projection.
 */
export interface AutomationExecutionStatusHandler {
  getStatus(executionId: string): {
    projection: AutomationCommandResult<'execution.status'>;
    source: AutomationSource;
  } | undefined;
}

/** Main-owned desktop toast / dialog for `ui.notify`. */
export interface AutomationUiNotifyHandler {
  notify(input: AutomationCommandInput<'ui.notify'>): void | Promise<void>;
}

export interface AutomationUndoGroupHandler {
  create(input: { executionId: string; libraryId: string }): { undoGroupId: string };
  append(input: {
    undoGroupId: string;
    item: { itemId: string; kind: string; reference: string; reversible: boolean };
  }): void;
  complete(input: {
    undoGroupId: string;
    status: 'succeeded' | 'partially-succeeded' | 'failed' | 'cancelled';
    failureReason?: string | null;
  }): void;
}

/**
 * Main-owned projection hook for the Worker history receipt.  The callback is
 * deliberately advisory: the Worker has already committed the mutation and
 * the Gateway must not turn a successful business operation into a failure if
 * an execution journal or Desktop notification is temporarily unavailable.
 */
export interface AutomationHistoryEntryHandler {
  onCommitted(input: {
    executionId: string;
    commandId: AutomationCommandId;
    libraryId: string;
    historyEntryId: string;
    source: AutomationSource;
  }): void | Promise<void>;
}

export interface AutomationCommandGatewayOptions {
  /** Durable only for completed stateless calls; in-flight coordination stays in memory. */
  idempotencyStore?: AutomationIdempotencyStore;
  auditSink?: AutomationExecutionAuditSink;
  auditLogger?: AutomationGatewayAuditLogger;
  externalEffectHandler?: AutomationExternalEffectHandler;
  filePlanApprovalHandler?: AutomationFilePlanApprovalHandler;
  libraryBindingHandler?: AutomationLibraryBindingHandler;
  libraryContextHandler?: AutomationLibraryContextHandler;
  mcpInputNormalizer?: (input: {
    commandId: AutomationCommandId;
    executionId: string;
    context: AutomationExecutionContext;
    commandInput: unknown;
    signal?: AbortSignal;
  }) => Promise<unknown | undefined>;
  contextBarrier?: AutomationContextBarrier;
  executionStatusHandler?: AutomationExecutionStatusHandler;
  uiNotifyHandler?: AutomationUiNotifyHandler;
  undoGroupHandler?: AutomationUndoGroupHandler;
  historyEntryHandler?: AutomationHistoryEntryHandler;
  permissionBroker?: AutomationPermissionBroker;
  /**
   * Serpent-ihpx: an automation import (MCP/script/console) completed — the
   * SAME side effects as a human import must fire (automatic AI analysis).
   * Called synchronously with the projected asset IDs; a throwing hook must
   * not fail the already-committed import.
   */
  onImportCompleted?: (input: {
    libraryId: string;
    importedAssetIds: string[];
    source: AutomationSource;
  }) => void;
}

export interface AutomationCommandGateway {
  execute(envelope: unknown, options?: {
    signal?: AbortSignal;
    contextOverrides?: {
      libraryId?: string | null;
      activeLibrary?: AutomationExecutionContext['activeLibrary'];
      contextRevision?: number;
      stateless?: boolean;
    };
  }): Promise<AutomationGatewayResult>;
  /** Complete the Worker-owned group opened for one script/console execution. */
  completeExecutionHistoryGroup(executionId: string): Promise<boolean>;
}

function gatewayFailure(code: AutomationGatewayErrorCode): AutomationGatewayFailure {
  return { ok: false, error: createAutomationGatewayError(code) };
}

function cancellationFailure(signal: AbortSignal): AutomationGatewayFailure {
  return gatewayFailure(signal.reason === 'timed-out'
    ? 'AUTOMATION_EXECUTION_TIMED_OUT'
    : 'AUTOMATION_EXECUTION_CANCELLED');
}

function hasCapabilities(
  grantedCapabilities: readonly AutomationCapability[],
  requiredCapabilities: readonly AutomationCapability[],
): boolean {
  const granted = new Set(grantedCapabilities);
  return requiredCapabilities.every((capability) => granted.has(capability));
}

function isSourceAllowed(
  source: AutomationSource,
  allowedSources: readonly AutomationSource[],
): boolean {
  return allowedSources.includes(source);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function idempotencyFingerprint(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex');
}

function historyEntryIdFromWorkerResult(result: WorkerResult): string | undefined {
  if (typeof result !== 'object' || result === null || !('historyEntryId' in result)) return undefined;
  const historyEntryId = (result as { historyEntryId?: unknown }).historyEntryId;
  return typeof historyEntryId === 'string' && historyEntryId.trim().length > 0
    ? historyEntryId
    : undefined;
}

export function createAutomationCommandGateway(
  workerClient: AutomationWorkerClient,
  executionResolver: AutomationExecutionResolver,
  options: AutomationCommandGatewayOptions = {},
): AutomationCommandGateway {
  const {
    auditSink,
    auditLogger,
    externalEffectHandler,
    filePlanApprovalHandler,
    libraryBindingHandler,
    libraryContextHandler,
    mcpInputNormalizer,
    contextBarrier,
    executionStatusHandler,
    uiNotifyHandler,
    undoGroupHandler,
    historyEntryHandler,
    permissionBroker,
    onImportCompleted,
    idempotencyStore,
  } = options;
  const inFlightCommandCounts = new Map<string, number>();
  type ExecutionHistoryGroup = {
    libraryId: string;
    historyEntryId: string;
    source: 'script' | 'desktop';
  };
  const executionHistoryGroups = new Map<string, ExecutionHistoryGroup>();
  /** Serialize the first group handshake when a script dispatches commands concurrently. */
  const pendingHistoryGroupBegins = new Map<string, Promise<ExecutionHistoryGroup | undefined>>();
  // Serpent-8b5b.4 review: cap idempotency retention so a chatty client with
  // unique keys cannot grow the map without bound; oldest entries evict first.
  const IDEMPOTENCY_ENTRY_LIMIT = 4096;
  const idempotencyEntries = new Map<string, {
    fingerprint: string;
    promise: Promise<AutomationGatewayResult>;
    resolve: (result: AutomationGatewayResult) => void;
  }>();
  if (auditSink !== undefined && auditLogger === undefined) {
    throw new TypeError('Automation Gateway requires an AppLogger when execution auditing is enabled.');
  }

  const reserveCommandSlot = (context: AutomationExecutionContext): boolean => {
    const limit = context.resourceBudget?.maxConcurrentCommands;
    if (limit === undefined) return true;
    const inFlight = inFlightCommandCounts.get(context.executionId) ?? 0;
    if (inFlight >= limit) return false;
    inFlightCommandCounts.set(context.executionId, inFlight + 1);
    return true;
  };

  const releaseCommandSlot = (context: AutomationExecutionContext): void => {
    if (context.resourceBudget?.maxConcurrentCommands === undefined) return;
    const inFlight = inFlightCommandCounts.get(context.executionId) ?? 0;
    if (inFlight <= 1) inFlightCommandCounts.delete(context.executionId);
    else inFlightCommandCounts.set(context.executionId, inFlight - 1);
  };

  const beginExecutionHistoryGroup = async (
    executionId: string,
    libraryId: string,
    source: 'script' | 'desktop',
  ): Promise<ExecutionHistoryGroup | undefined> => {
    const existing = executionHistoryGroups.get(executionId);
    if (existing !== undefined) return existing;
    const pending = pendingHistoryGroupBegins.get(executionId);
    if (pending !== undefined) return pending;

    const start = (async (): Promise<ExecutionHistoryGroup | undefined> => {
      try {
        const result = await workerClient.request({ type: 'history.group.begin', libraryId }, {
          historyContext: {
            source,
            sourceReference: executionId,
          },
        });
        if (!result.ok || result.type !== 'history.group.begun') {
          auditLogger?.error('automation.history-group.begin-invalid', new Error('Worker returned an invalid history group start.'), {
            executionId,
            libraryId,
          });
          return undefined;
        }
        const group: ExecutionHistoryGroup = {
          libraryId,
          historyEntryId: result.historyEntryId,
          source,
        };
        executionHistoryGroups.set(executionId, group);
        return group;
      } catch (error) {
        auditLogger?.error('automation.history-group.begin-failed', error, { executionId, libraryId });
        return undefined;
      } finally {
        pendingHistoryGroupBegins.delete(executionId);
      }
    })();
    pendingHistoryGroupBegins.set(executionId, start);
    return start;
  };

  const completeExecutionHistoryGroup = async (executionId: string): Promise<boolean> => {
    const pending = pendingHistoryGroupBegins.get(executionId);
    if (pending !== undefined) await pending;
    const group = executionHistoryGroups.get(executionId);
    if (group === undefined) return true;
    try {
      const result = await workerClient.request({
        type: 'history.group.complete',
        libraryId: group.libraryId,
        expectedHistoryEntryId: group.historyEntryId,
      }, {
        historyContext: {
          source: group.source,
          sourceReference: executionId,
          historyGroupId: group.historyEntryId,
        },
      });
      if (!result.ok || result.type !== 'history.group.completed'
        || result.historyEntryId !== group.historyEntryId) {
        auditLogger?.error('automation.history-group.complete-invalid', new Error('Worker returned an invalid history group completion.'), {
          executionId,
          historyEntryId: group.historyEntryId,
        });
        return false;
      }
      executionHistoryGroups.delete(executionId);
      return true;
    } catch (error) {
      auditLogger?.error('automation.history-group.complete-failed', error, {
        executionId,
        historyEntryId: group.historyEntryId,
      });
      return false;
    }
  };

  return {
    async completeExecutionHistoryGroup(executionId: string): Promise<boolean> {
      return completeExecutionHistoryGroup(executionId);
    },
    async execute(
      envelope: unknown,
      options?: {
        signal?: AbortSignal;
        contextOverrides?: {
          libraryId?: string | null;
          activeLibrary?: AutomationExecutionContext['activeLibrary'];
          contextRevision?: number;
          stateless?: boolean;
        };
      },
    ): Promise<AutomationGatewayResult> {
      const parsedEnvelope = automationCommandEnvelopeSchema.safeParse(envelope);
      if (!parsedEnvelope.success) return gatewayFailure('AUTOMATION_INVALID_REQUEST');

      const { apiVersion, commandId, executionId, input: envelopeInput } = parsedEnvelope.data;
      // Serpent-8b5b.2: challenge confirmation fields are stripped after the
      // broker consumes the challenge, before schema parsing / worker dispatch.
      let input: unknown = envelopeInput;
      if (apiVersion !== AUTOMATION_API_VERSION) {
        return gatewayFailure('AUTOMATION_API_VERSION_UNSUPPORTED');
      }

      const descriptor = getAutomationCommandDescriptor(commandId);
      if (!descriptor) return gatewayFailure('AUTOMATION_COMMAND_NOT_FOUND');

      if (descriptor.commandId === 'execution.status') {
        if (!executionStatusHandler) {
          return { ok: false, error: createPublicError('INTERNAL_ERROR') };
        }
        const parsedInput = descriptor.inputSchema.safeParse(input);
        if (!parsedInput.success) return gatewayFailure('AUTOMATION_INVALID_REQUEST');
        const statusInput = parsedInput.data as AutomationCommandInput<'execution.status'>;
        const targetExecutionId = statusInput.executionId ?? executionId;
        if (targetExecutionId !== executionId) {
          return gatewayFailure('AUTOMATION_EXECUTION_NOT_FOUND');
        }
        const statusRecord = executionStatusHandler.getStatus(targetExecutionId);
        if (!statusRecord) return gatewayFailure('AUTOMATION_EXECUTION_NOT_FOUND');
        if (!isSourceAllowed(statusRecord.source, descriptor.allowedSources)) {
          return gatewayFailure('AUTOMATION_SOURCE_NOT_ALLOWED');
        }
        if (!descriptor.resultSchema.safeParse(statusRecord.projection).success) {
          return gatewayFailure('AUTOMATION_RESULT_INVALID');
        }
        return {
          ok: true,
          apiVersion: AUTOMATION_API_VERSION,
          commandId: 'execution.status',
          executionId,
          result: statusRecord.projection,
        };
      }

      let resolvedContext: AutomationExecutionContext | undefined;
      try {
        resolvedContext = await executionResolver.resolve(executionId);
      } catch (error) {
        auditLogger?.error('automation.execution.resolve-failed', error, { executionId });
        return { ok: false, error: toPublicError(error) };
      }
      if (!resolvedContext || resolvedContext.executionId !== executionId) {
        return gatewayFailure('AUTOMATION_EXECUTION_NOT_FOUND');
      }
      const stateless = options?.contextOverrides?.stateless === true;
      let context: AutomationExecutionContext = options?.contextOverrides === undefined
        ? resolvedContext
        : {
          ...resolvedContext,
          ...(options.contextOverrides.libraryId === undefined ? {} : { libraryId: options.contextOverrides.libraryId }),
          ...(options.contextOverrides.activeLibrary === undefined ? {} : { activeLibrary: options.contextOverrides.activeLibrary }),
          ...(options.contextOverrides.contextRevision === undefined ? {} : { contextRevision: options.contextOverrides.contextRevision }),
        };
      if (options?.signal !== undefined) {
        context = context.abortSignal === undefined
          ? { ...context, abortSignal: options.signal }
          : { ...context, abortSignal: AbortSignal.any([context.abortSignal, options.signal]) };
      }
      let contextLease: { release: () => void } | undefined;
      const releaseContextLease = (): void => {
        contextLease?.release();
        contextLease = undefined;
      };
      const outcomeFailureCode = (result: AutomationGatewayResult): string | undefined => {
        if (result.ok) return undefined;
        if ('challenge' in result && result.challenge !== undefined) {
          return 'AUTOMATION_CHALLENGE_REQUIRED';
        }
        return (result as AutomationGatewayFailure).error.code;
      };
      const recordOutcome = async (result: AutomationGatewayResult): Promise<AutomationGatewayResult> => {
        try {
          await auditSink?.recordCommandResult(
            executionId,
            descriptor.commandId,
            result.ok ? 'succeeded' : 'failed',
            outcomeFailureCode(result),
          );
        } catch (error) {
          // The command result is already complete and must remain stable even
          // when local execution-history persistence is temporarily unavailable.
          // AppLogger remains independent of the history file so the failure
          // is still durable and locatable by execution ID.
          auditLogger?.error('automation.execution.audit-failed', error, {
            executionId,
            commandId: descriptor.commandId,
            outcome: result.ok ? 'succeeded' : 'failed',
            ...(result.ok ? {} : { failureCode: outcomeFailureCode(result) }),
          });
        }
        releaseContextLease();
        return result;
      };
      if (context.abortSignal?.aborted) {
        return cancellationFailure(context.abortSignal);
      }
      if (!isSourceAllowed(context.source, descriptor.allowedSources)) {
        return recordOutcome(gatewayFailure('AUTOMATION_SOURCE_NOT_ALLOWED'));
      }
      const isCriticalOperation = descriptor.criticalOperation === true;
      if (isCriticalOperation) {
        // Serpent-8b5b.2: dangerous commands are MCP-only and gated entirely
        // by the two-phase agent challenge — capabilities are never askable
        // for them, and the first call must not dispatch anything.
        if (context.source !== 'mcp' || permissionBroker === undefined) {
          return recordOutcome(gatewayFailure('AUTOMATION_SOURCE_NOT_ALLOWED'));
        }
        const authorization = await permissionBroker.authorize({
          context,
          descriptor,
          commandInput: input,
          signal: context.abortSignal,
        });
        if (!authorization.allowed) {
          if (authorization.reason === 'challenge-required') {
            return recordOutcome({ ok: false, challenge: authorization.challenge });
          }
          return recordOutcome(authorization.reason === 'cancelled'
            ? cancellationFailure(context.abortSignal ?? new AbortController().signal)
            : gatewayFailure('AUTOMATION_CAPABILITY_DENIED'));
        }
        if (authorization.challengeConsumed === true) {
          input = stripMcpChallengeConfirmationFields(input);
        }
      } else {
        const missingCapabilities = descriptor.requiredCapabilities.filter(
          (capability) => !context.grantedCapabilities.includes(capability),
        );
        const requestableCapabilities = getAutomationCommandPermissionMetadata(descriptor)
          .requestableCapabilities;
        const missingRequestableCapabilities = missingCapabilities.filter(
          (capability) => requestableCapabilities.includes(capability),
        );
        const missingNonRequestableCapabilities = missingCapabilities.filter(
          (capability) => !requestableCapabilities.includes(capability),
        );
        if (missingNonRequestableCapabilities.length > 0) {
          return recordOutcome(gatewayFailure('AUTOMATION_CAPABILITY_DENIED'));
        }
        const deferPlanPermission = descriptor.approvalPolicy === 'plan'
          && context.source === 'mcp'
          && permissionBroker !== undefined
          && missingRequestableCapabilities.length > 0;
        // Serpent-8b5b.8 review: a read-only credential must be gated on
        // EVERY write, not only on askable capabilities — allow-policy write
        // capabilities (e.g. library.create) are pre-granted by the session
        // and would otherwise bypass the permission broker entirely.
        const mustAuthorizeWrite = context.source === 'mcp'
          && permissionBroker !== undefined
          && descriptor.impact !== 'read'
          && !deferPlanPermission;
        if ((missingRequestableCapabilities.length > 0 && !deferPlanPermission) || mustAuthorizeWrite) {
          if (context.source !== 'mcp' || permissionBroker === undefined) {
            return recordOutcome(gatewayFailure('AUTOMATION_CAPABILITY_DENIED'));
          }
          const authorization = await permissionBroker.authorize({
            context,
            descriptor,
            commandInput: input,
            signal: context.abortSignal,
          });
          if (!authorization.allowed) {
            return recordOutcome(authorization.reason === 'cancelled'
              ? cancellationFailure(context.abortSignal ?? new AbortController().signal)
              : gatewayFailure('AUTOMATION_CAPABILITY_DENIED'));
          }
          context = {
            ...context,
            grantedCapabilities: [...new Set([
              ...context.grantedCapabilities,
              ...missingRequestableCapabilities,
            ])],
          };
        }
        if (!deferPlanPermission && !hasCapabilities(context.grantedCapabilities, descriptor.requiredCapabilities)) {
          return recordOutcome(gatewayFailure('AUTOMATION_CAPABILITY_DENIED'));
        }
      }

      let normalizedInput = input;
      if (context.source === 'mcp' && mcpInputNormalizer !== undefined) {
        try {
          normalizedInput = await mcpInputNormalizer({
            commandId: descriptor.commandId,
            executionId,
            context,
            commandInput: input,
            signal: context.abortSignal,
          });
        } catch (error) {
          auditLogger?.error('automation.mcp-input-normalize-failed', error, {
            executionId,
            commandId,
          });
          return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
        }
      }
      const parsedInput = descriptor.inputSchema.safeParse(normalizedInput);
      if (!parsedInput.success) return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
      const libraryContext = descriptor.libraryContext
        ?? (descriptor.targetScope === 'library'
          || descriptor.targetScope === 'asset'
          || descriptor.targetScope === 'asset-set'
          || descriptor.targetScope === 'job-set'
          ? 'active'
          : 'none');
      if (libraryContext === 'active' && context.libraryId === null) {
        return recordOutcome(gatewayFailure(
          context.contextRevision === undefined
            ? 'AUTOMATION_LIBRARY_NOT_BOUND'
            : 'AUTOMATION_LIBRARY_CONTEXT_REQUIRED',
        ));
      }
      if ((commandId === 'library.list-open' || commandId === 'library.list-recent' || commandId === 'library.open' || commandId === 'library.show-in-desktop')
        && libraryContextHandler !== undefined) {
        try {
          const result = await libraryContextHandler.execute({
            commandId,
            executionId,
            context,
            commandInput: parsedInput.data,
            signal: context.abortSignal,
          });
          if (context.abortSignal?.aborted) {
            return recordOutcome(cancellationFailure(context.abortSignal));
          }
          if (!descriptor.resultSchema.safeParse(result).success) {
            return recordOutcome(gatewayFailure('AUTOMATION_RESULT_INVALID'));
          }
          return recordOutcome({
            ok: true,
            apiVersion: AUTOMATION_API_VERSION,
            commandId,
            executionId,
            result: result as AutomationCommandResult<typeof commandId>,
          });
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
          const stableCodes = new Set<AutomationGatewayErrorCode>([
            'AUTOMATION_LIBRARY_CONTEXT_REQUIRED',
            'AUTOMATION_LIBRARY_CONTEXT_CONFLICT',
            'AUTOMATION_LIBRARY_CONTEXT_BUSY',
            'AUTOMATION_LIBRARY_NOT_OPEN',
            'AUTOMATION_LIBRARY_OPEN_FAILED',
            'AUTOMATION_LIBRARY_AUTHORIZATION_REQUIRED',
            'AUTOMATION_LIBRARY_SWITCH_DENIED',
          ]);
          return recordOutcome(
            typeof code === 'string' && stableCodes.has(code as AutomationGatewayErrorCode)
              ? gatewayFailure(code as AutomationGatewayErrorCode)
              : { ok: false, error: toPublicError(error) },
          );
        }
      }
      const parsedCommandInput = parsedInput.data as Record<string, unknown>;
      const idempotencyKey = descriptor.supportsIdempotencyKey
        ? idempotencyKeySchema.safeParse(parsedCommandInput.idempotencyKey).success
          ? parsedCommandInput.idempotencyKey as string
          : undefined
        : undefined;
      if (parsedCommandInput.idempotencyKey !== undefined && !descriptor.supportsIdempotencyKey) {
        return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
      }
      if (descriptor.supportsIdempotencyKey && parsedCommandInput.idempotencyKey !== undefined
        && idempotencyKey === undefined) {
        return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
      }
      const idempotencyPayload = { ...parsedCommandInput };
      delete idempotencyPayload.idempotencyKey;
      const idempotencyOwner = stateless
        ? (context.clientCredentialId ?? executionId)
        : executionId;
      const idempotencyEntryKey = idempotencyKey === undefined
        ? undefined
        : `${idempotencyOwner}\u0000${context.libraryId ?? ''}\u0000${descriptor.commandId}\u0000${idempotencyKey}`;
      if (descriptor.commandId === 'library.create'
        && libraryBindingHandler?.transitionLibraryContext === undefined
        && libraryBindingHandler?.bindLibrary === undefined) {
        // Host misconfiguration — not an open/bind failure of a created library.
        return recordOutcome({ ok: false, error: createPublicError('INTERNAL_ERROR') });
      }
      let idempotencyEntry: {
        fingerprint: string;
        promise: Promise<AutomationGatewayResult>;
        resolve: (result: AutomationGatewayResult) => void;
      } | undefined;
      if (idempotencyEntryKey !== undefined) {
        const fingerprint = idempotencyFingerprint(idempotencyPayload);
        const durable = idempotencyStore?.get(idempotencyEntryKey);
        if (durable !== undefined) {
          if (durable.fingerprint !== fingerprint) {
            return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
          }
          return durable.result as AutomationGatewayResult;
        }
        const existing = idempotencyEntries.get(idempotencyEntryKey);
        if (existing !== undefined) {
          if (existing.fingerprint !== fingerprint) {
            return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
          }
          return existing.promise;
        }
        let resolveEntry!: (result: AutomationGatewayResult) => void;
        const promise = new Promise<AutomationGatewayResult>((resolve) => {
          resolveEntry = resolve;
        });
        idempotencyEntry = { fingerprint, promise, resolve: resolveEntry };
        if (idempotencyEntries.size >= IDEMPOTENCY_ENTRY_LIMIT) {
          const oldestKey = idempotencyEntries.keys().next().value;
          if (oldestKey !== undefined) idempotencyEntries.delete(oldestKey);
        }
        idempotencyEntries.set(idempotencyEntryKey, idempotencyEntry);
      }
      if (libraryContext === 'active' && contextBarrier !== undefined) {
        try {
          contextLease = contextBarrier.beginCommand(
            executionId,
            context.contextRevision ?? 0,
          );
        } catch (error) {
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
          const stableCodes = new Set<AutomationGatewayErrorCode>([
            'AUTOMATION_LIBRARY_CONTEXT_CONFLICT',
            'AUTOMATION_LIBRARY_CONTEXT_BUSY',
          ]);
          if (idempotencyEntryKey !== undefined) idempotencyEntries.delete(idempotencyEntryKey);
          return recordOutcome(
            typeof code === 'string' && stableCodes.has(code as AutomationGatewayErrorCode)
              ? gatewayFailure(code as AutomationGatewayErrorCode)
              : gatewayFailure('AUTOMATION_LIBRARY_CONTEXT_CONFLICT'),
          );
        }
      }
      const completeIdempotency = (result: AutomationGatewayResult): void => {
        if (idempotencyEntry === undefined || idempotencyEntryKey === undefined) return;
        if (!result.ok) idempotencyEntries.delete(idempotencyEntryKey);
        else {
          try {
            idempotencyStore?.put(idempotencyEntryKey, {
              fingerprint: idempotencyEntry.fingerprint,
              result,
              completedAt: new Date().toISOString(),
            });
          } catch (error) {
            auditLogger?.error('automation.idempotency.persist-failed', error, {
              commandId: descriptor.commandId,
            });
          }
        }
        idempotencyEntry.resolve(result);
      };
      const recordIdempotentOutcome = async (result: AutomationGatewayResult): Promise<AutomationGatewayResult> => {
        const completed = await recordOutcome(result);
        completeIdempotency(completed);
        return completed;
      };
      const boundLibraryId = context.libraryId;

      const shouldGroupHistory = (context.source === 'script' || context.source === 'desktop-console')
        && descriptor.history?.policy === 'reversible'
        && boundLibraryId !== null;
      let historyGroup = shouldGroupHistory ? executionHistoryGroups.get(executionId) : undefined;

      if (descriptor.commandId === 'ui.notify') {
        if (!uiNotifyHandler) {
          return recordOutcome({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
        const notifyInput = parsedInput.data as AutomationCommandInput<'ui.notify'>;
        try {
          await uiNotifyHandler.notify(notifyInput);
        } catch (error) {
          auditLogger?.error('automation.ui-notify.failed', error, { executionId });
          return recordOutcome({ ok: false, error: toPublicError(error) });
        }
        const result = {
          shown: true as const,
          mode: notifyInput.mode,
          severity: notifyInput.severity,
        };
        if (!descriptor.resultSchema.safeParse(result).success) {
          return recordOutcome(gatewayFailure('AUTOMATION_RESULT_INVALID'));
        }
        return recordOutcome({
          ok: true,
          apiVersion: AUTOMATION_API_VERSION,
          commandId: 'ui.notify',
          executionId,
          result,
        });
      }

      let approvedPlan: AutomationFileOperationPlanProof | undefined;
      if (descriptor.approvalPolicy === 'plan') {
        if (!filePlanApprovalHandler) {
          return recordIdempotentOutcome({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
        try {
          approvedPlan = await filePlanApprovalHandler.prepareAndApprove({
            commandId: descriptor.commandId,
            executionId,
            libraryId: boundLibraryId,
            commandInput: parsedInput.data,
            source: context.source,
            ...(context.clientName === undefined ? {} : { clientName: context.clientName }),
            ...(context.activeLibrary?.displayName === undefined
              ? {}
              : { libraryDisplayName: context.activeLibrary.displayName }),
            ...(context.source === 'mcp' && permissionBroker !== undefined
              ? {
                requestApproval: async ({ summary }) => {
                  const authorization = await permissionBroker.authorize({
                    context,
                    descriptor,
                    commandInput: parsedInput.data,
                    planSummary: summary,
                    signal: context.abortSignal,
                  });
                  return authorization.allowed;
                },
              }
              : {}),
          });
        } catch (error) {
          auditLogger?.error('automation.file-plan.failed', error, {
            executionId,
            commandId: descriptor.commandId,
          });
          if (error instanceof PluginHookBlockedError) {
            return recordIdempotentOutcome({
              ok: false,
              error: createPublicError('PLUGIN_HOOK_BLOCKED'),
            });
          }
          return recordIdempotentOutcome({ ok: false, error: toPublicError(error) });
        }
        // Cancellation is not an error: the script receives a stable public
        // result and no Worker mutation is dispatched.
        if (approvedPlan === undefined) {
          return recordIdempotentOutcome({ ok: false, error: createPublicError('CANCELLED') });
        }
        if (context.abortSignal?.aborted) return recordIdempotentOutcome(cancellationFailure(context.abortSignal));
      }
      if (!reserveCommandSlot(context)) {
        return recordIdempotentOutcome(gatewayFailure('AUTOMATION_CONCURRENCY_LIMIT_REACHED'));
      }
      let undoGroupId: string | undefined;
      // Unified history is owned by the Worker. Keep the old journal bridge
      // only for descriptors that have not migrated yet; migrated commands
      // must never create a second executable undo authority.
      const usesUnifiedHistory = descriptor.history?.policy !== undefined
        && descriptor.history.policy !== 'none';
      if (!usesUnifiedHistory && descriptor.supportsUndo && undoGroupHandler !== undefined) {
        if (boundLibraryId === null) {
          releaseCommandSlot(context);
          return recordIdempotentOutcome(gatewayFailure('AUTOMATION_LIBRARY_NOT_BOUND'));
        }
        try {
          undoGroupId = undoGroupHandler.create({ executionId, libraryId: boundLibraryId }).undoGroupId;
        } catch (error) {
          auditLogger?.error('automation.undo-group.create-failed', error, { executionId, commandId });
          releaseCommandSlot(context);
          return recordIdempotentOutcome({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
      }
      const recordOutcomeAndReleaseSlot = async (
        result: AutomationGatewayResult,
      ): Promise<AutomationGatewayResult> => {
        try {
          if (undoGroupId !== undefined) {
            if (undoGroupHandler === undefined) {
              throw new Error('Undo group handler disappeared after creating an undo group.');
            }
            if (result.ok) {
              const operationId = typeof result.result === 'object'
                && result.result !== null
                && 'operationId' in result.result
                && typeof result.result.operationId === 'string'
                ? result.result.operationId
                : undefined;
              undoGroupHandler.append({
                undoGroupId,
                item: {
                  itemId: operationId ?? `${executionId}:${descriptor.commandId}:${Date.now()}`,
                  kind: descriptor.commandId,
                  reference: operationId === undefined ? `execution:${executionId}` : operationId,
                  reversible: operationId !== undefined,
                },
              });
              undoGroupHandler.complete({
                undoGroupId,
                status: operationId === undefined ? 'partially-succeeded' : 'succeeded',
                ...(operationId === undefined ? { failureReason: 'Worker returned no recovery reference.' } : {}),
              });
            }
            else if (!('challenge' in result && result.challenge !== undefined)) {
              undoGroupHandler.complete({
                undoGroupId,
                status: 'failed',
                failureReason: (result as AutomationGatewayFailure).error.message,
              });
            }
          }
        return await recordIdempotentOutcome(result);
        } catch (error) {
          auditLogger?.error('automation.undo-group.finalize-failed', error, {
            executionId,
            commandId: descriptor.commandId,
            undoGroupId,
          });
          if (result.ok) {
            // Worker mutation already committed; surface journal failure instead of
            // silently claiming a durable undo group.
            return await recordOutcome({ ok: false, error: createPublicError('INTERNAL_ERROR') });
          }
          return await recordOutcome(result);
        } finally {
          // The slot represents the entire Gateway request, including schema
          // projection and durable execution audit, not merely Worker time.
          releaseCommandSlot(context);
        }
      };

      let workerResult: WorkerResult;
      const requestWorker = async (plan: AutomationFileOperationPlanProof | undefined): Promise<WorkerResult> =>
        workerClient.request(
          descriptor.toWorkerCommand(boundLibraryId ?? '', parsedInput.data, plan),
          {
            signal: context.abortSignal,
            readonly: descriptor.impact === 'read',
            historyContext: {
              source: context.source === 'desktop-console' || context.source === 'test'
                ? 'desktop'
                : context.source,
              sourceReference: executionId,
              ...(historyGroup === undefined ? {} : { historyGroupId: historyGroup.historyEntryId }),
            },
          },
      );
      if (shouldGroupHistory && historyGroup === undefined) {
        historyGroup = await beginExecutionHistoryGroup(
          executionId,
          boundLibraryId,
          context.source === 'desktop-console' ? 'desktop' : 'script',
        );
        if (historyGroup === undefined) {
          return recordOutcomeAndReleaseSlot({
            ok: false,
            error: createPublicError('INTERNAL_ERROR'),
          });
        }
      }
      try {
        workerResult = await requestWorker(approvedPlan);
      } catch (error) {
        if (context.abortSignal?.aborted) return recordOutcomeAndReleaseSlot(cancellationFailure(context.abortSignal));
        return recordOutcomeAndReleaseSlot({ ok: false, error: toPublicError(error) });
      }

      // Thumbnail jobs and concurrent imports can advance the library
      // sequence after planning but before apply. Re-plan at most once for the
      // explicit stale-plan error; never retry an unknown or post-commit error.
      if (descriptor.commandId === 'file.import'
        && !workerResult.ok
        && workerResult.error.code === 'VERSION_CONFLICT'
        && filePlanApprovalHandler !== undefined) {
        try {
          approvedPlan = await filePlanApprovalHandler.prepareAndApprove({
            commandId: descriptor.commandId,
            executionId,
            libraryId: boundLibraryId,
            commandInput: parsedInput.data,
            source: context.source,
            ...(context.clientName === undefined ? {} : { clientName: context.clientName }),
            ...(context.activeLibrary?.displayName === undefined ? {} : { libraryDisplayName: context.activeLibrary.displayName }),
            ...(context.source === 'mcp' && permissionBroker !== undefined
              ? {
                requestApproval: async ({ summary }) => {
                  const authorization = await permissionBroker.authorize({
                    context,
                    descriptor,
                    commandInput: parsedInput.data,
                    planSummary: summary,
                    signal: context.abortSignal,
                  });
                  return authorization.allowed;
                },
              }
              : {}),
          });
          if (approvedPlan !== undefined) workerResult = await requestWorker(approvedPlan);
        } catch (error) {
          auditLogger?.error('automation.file-plan.retry-failed', error, { executionId, commandId: descriptor.commandId });
          return recordOutcomeAndReleaseSlot({ ok: false, error: toPublicError(error) });
        }
      }

      if (context.abortSignal?.aborted) return recordOutcomeAndReleaseSlot(cancellationFailure(context.abortSignal));

      if (!workerResult.ok) return recordOutcomeAndReleaseSlot({ ok: false, error: workerResult.error });
      if (!descriptor.workerResultSchema.safeParse(workerResult).success) {
        return recordOutcomeAndReleaseSlot(gatewayFailure('AUTOMATION_RESULT_INVALID'));
      }

      if (descriptor.impact === 'external-effect') {
        if (!externalEffectHandler) {
          return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
        try {
          await externalEffectHandler.apply({
            commandId: descriptor.commandId,
            executionId,
            libraryId: boundLibraryId!,
            commandInput: parsedInput.data,
            workerResult,
          });
        } catch (error) {
          auditLogger?.error('automation.external-effect.failed', error, {
            executionId,
            commandId: descriptor.commandId,
          });
          return recordOutcomeAndReleaseSlot({ ok: false, error: toPublicError(error) });
        }
        if (context.abortSignal?.aborted) {
          return recordOutcomeAndReleaseSlot(cancellationFailure(context.abortSignal));
        }
      }

      const result = descriptor.projectResult(workerResult, boundLibraryId ?? '', parsedInput.data);
      if (result === undefined || !descriptor.resultSchema.safeParse(result).success) {
        // library.inspect projects library.list down to the one library bound
        // to this execution. A missing entry is the same public state as a
        // Worker request against a library that is no longer open.
        if (descriptor.commandId === 'library.inspect') {
          return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('LIBRARY_NOT_OPEN') });
        }
        return recordOutcomeAndReleaseSlot(gatewayFailure('AUTOMATION_RESULT_INVALID'));
      }

      const historyEntryId = historyEntryIdFromWorkerResult(workerResult);

      if (historyEntryId !== undefined && historyEntryHandler !== undefined && boundLibraryId !== null) {
        try {
          await historyEntryHandler.onCommitted({
            executionId,
            commandId: descriptor.commandId,
            libraryId: boundLibraryId,
            historyEntryId,
            source: context.source,
          });
        } catch (error) {
          // History is authoritative in the Worker.  This is only the
          // Main-side execution/UI projection and must never roll back a
          // committed mutation or make the command appear to have failed.
          auditLogger?.error('automation.history-projection.failed', error, {
            executionId,
            commandId: descriptor.commandId,
            historyEntryId,
          });
        }
      }

      // Serpent-ihpx: an automation import must behave like a human import —
      // same post-import side effects (automatic AI analysis). Fires only for
      // a completed import with projected asset IDs (conflicts import
      // nothing); a throwing hook must not fail the committed import.
      if (descriptor.commandId === 'file.import' && onImportCompleted !== undefined && boundLibraryId !== undefined && boundLibraryId !== null) {
        const importResult = result as { status?: unknown; completion?: { assets?: Array<{ assetId?: unknown }> } };
        if (importResult.status === 'completed') {
          const importedAssetIds = Array.isArray(importResult.completion?.assets)
            ? importResult.completion.assets
              .map((asset) => asset.assetId)
              .filter((assetId): assetId is string => typeof assetId === 'string')
            : [];
          if (importedAssetIds.length > 0) {
            try {
              onImportCompleted({ libraryId: boundLibraryId, importedAssetIds, source: context.source });
            } catch (error) {
              auditLogger?.error('automation.import-completed-hook.failed', error, {
                executionId,
                commandId: descriptor.commandId,
              });
            }
          }
        }
      }

      if (descriptor.commandId === 'library.create' && !stateless) {
        const createdLibrary = result as { libraryId?: unknown };
        if (typeof createdLibrary.libraryId !== 'string') {
          return recordOutcomeAndReleaseSlot(gatewayFailure('AUTOMATION_RESULT_INVALID'));
        }
        if (libraryBindingHandler === undefined) {
          return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
        try {
          if (libraryBindingHandler.transitionLibraryContext !== undefined) {
            await libraryBindingHandler.transitionLibraryContext({
              executionId,
              source: context.source,
              libraryId: createdLibrary.libraryId,
              displayName: typeof (result as { displayName?: unknown }).displayName === 'string'
                ? (result as { displayName: string }).displayName
                : undefined,
              expectedRevision: context.contextRevision ?? 0,
              authorizationSource: 'approved-plan',
            });
          } else if (libraryBindingHandler.bindLibrary !== undefined) {
            await libraryBindingHandler.bindLibrary({
              executionId,
              libraryId: createdLibrary.libraryId,
            });
          } else {
            return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('INTERNAL_ERROR') });
          }
        } catch (error) {
          auditLogger?.error('automation.library-bind.failed', error, { executionId });
          const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined;
          return recordOutcomeAndReleaseSlot(
            typeof code === 'string'
              && code.startsWith('AUTOMATION_')
              && code in { AUTOMATION_LIBRARY_OPEN_FAILED: true, AUTOMATION_LIBRARY_CONTEXT_CONFLICT: true, AUTOMATION_LIBRARY_CONTEXT_BUSY: true }
              ? gatewayFailure(code as AutomationGatewayErrorCode)
              : gatewayFailure('AUTOMATION_LIBRARY_OPEN_FAILED'),
          );
        }
      }
      if (descriptor.commandId === 'library.create' && stateless
        && libraryBindingHandler?.onLibraryCreated !== undefined
        && workerResult.ok
        && workerResult.type === 'library.opened') {
        try {
          await libraryBindingHandler.onLibraryCreated({
            executionId,
            source: context.source,
            library: workerResult.library,
          });
        } catch (error) {
          auditLogger?.error('automation.library-create.side-effects-failed', error, { executionId });
          return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
      }

      // Keep MCP lifecycle mutations observable in Desktop as well. These
      // callbacks are Main-owned side effects only; failure to publish a UI
      // event must not turn a committed Worker mutation into an error.
      if (libraryBindingHandler !== undefined && workerResult.ok) {
        try {
          if (descriptor.commandId === 'library.close'
            && workerResult.type === 'library.closed'
            && libraryBindingHandler.onLibraryClosed !== undefined) {
            await libraryBindingHandler.onLibraryClosed({
              executionId, source: context.source, libraryId: workerResult.libraryId,
            });
          } else if (descriptor.commandId === 'library.rename'
            && workerResult.type === 'library.renamed'
            && libraryBindingHandler.onLibraryRenamed !== undefined) {
            await libraryBindingHandler.onLibraryRenamed({ executionId, source: context.source, library: workerResult.library });
          } else if (descriptor.commandId === 'library.delete-from-disk'
            && workerResult.type === 'library.deleted'
            && libraryBindingHandler.onLibraryDeleted !== undefined) {
            await libraryBindingHandler.onLibraryDeleted({
              executionId, source: context.source, libraryId: workerResult.libraryId,
              displayName: workerResult.displayName, libraryPath: workerResult.libraryPath,
            });
          } else if ((descriptor.commandId === 'library.import-folder' || descriptor.commandId === 'library.import-zip')
            && workerResult.type === 'library.imported'
            && libraryBindingHandler.onLibraryImported !== undefined) {
            await libraryBindingHandler.onLibraryImported({
              executionId, source: context.source, libraryId: workerResult.libraryId,
              displayName: workerResult.displayName, libraryPath: workerResult.libraryPath,
            });
          }
        } catch (error) {
          auditLogger?.error('automation.library-lifecycle.side-effects-failed', error, {
            executionId, commandId: descriptor.commandId,
          });
        }
      }

      return recordOutcomeAndReleaseSlot({
        ok: true,
        apiVersion: AUTOMATION_API_VERSION,
        commandId: descriptor.commandId,
        executionId,
        result,
        ...(historyEntryId === undefined ? {} : { historyEntryId }),
        ...(undoGroupId === undefined ? {} : { undoGroupId }),
      });
    },
  };
}
