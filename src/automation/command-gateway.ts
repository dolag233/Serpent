import { z } from 'zod';

import {
  AUTOMATION_API_VERSION,
  automationCapabilitySchema,
  automationSourceSchema,
  getAutomationCommandDescriptor,
  type AutomationCapability,
  type AutomationCommandId,
  type AutomationCommandResult,
  type AutomationFileOperationPlanProof,
  type AutomationSource,
} from './command-registry';
import type { PublicError } from '../shared/protocol/errors';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});

export const automationExecutionContextSchema = z.strictObject({
  executionId: nonBlankString.max(255),
  source: automationSourceSchema,
  libraryId: nonBlankString.max(255),
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

export type AutomationGatewayErrorCode =
  | 'AUTOMATION_INVALID_REQUEST'
  | 'AUTOMATION_API_VERSION_UNSUPPORTED'
  | 'AUTOMATION_COMMAND_NOT_FOUND'
  | 'AUTOMATION_EXECUTION_NOT_FOUND'
  | 'AUTOMATION_SOURCE_NOT_ALLOWED'
  | 'AUTOMATION_CAPABILITY_DENIED'
  | 'AUTOMATION_CONCURRENCY_LIMIT_REACHED'
  | 'AUTOMATION_EXECUTION_CANCELLED'
  | 'AUTOMATION_EXECUTION_TIMED_OUT'
  | 'AUTOMATION_RESULT_INVALID';

export interface AutomationGatewayError {
  code: AutomationGatewayErrorCode;
  message: string;
}

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
};

export type AutomationGatewayResult = AutomationGatewaySuccess | AutomationGatewayFailure;

/**
 * Deliberately narrower than LibraryWorkerClient. This prevents Gateway and
 * future Script/MCP adapters from reaching LibraryService, filesystem, SQL or
 * worker lifecycle operations directly.
 */
export interface AutomationWorkerClient {
  request(
    command: WorkerCommand,
    options?: { signal?: AbortSignal; readonly?: boolean },
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
    libraryId: string;
    commandInput: unknown;
  }): Promise<AutomationFileOperationPlanProof | undefined>;
}

export interface AutomationCommandGatewayOptions {
  auditSink?: AutomationExecutionAuditSink;
  auditLogger?: AutomationGatewayAuditLogger;
  externalEffectHandler?: AutomationExternalEffectHandler;
  filePlanApprovalHandler?: AutomationFilePlanApprovalHandler;
}

export interface AutomationCommandGateway {
  execute(envelope: unknown): Promise<AutomationGatewayResult>;
}

const errorMessages: Record<AutomationGatewayErrorCode, string> = {
  AUTOMATION_INVALID_REQUEST: 'The automation command request is invalid.',
  AUTOMATION_API_VERSION_UNSUPPORTED: 'This automation API version is not supported.',
  AUTOMATION_COMMAND_NOT_FOUND: 'This automation command is not available.',
  AUTOMATION_EXECUTION_NOT_FOUND: 'This automation execution is no longer available.',
  AUTOMATION_SOURCE_NOT_ALLOWED: 'This automation source cannot call the requested command.',
  AUTOMATION_CAPABILITY_DENIED: 'The automation execution has not been granted the required capability.',
  AUTOMATION_CONCURRENCY_LIMIT_REACHED: 'This automation execution has reached its concurrent command limit.',
  AUTOMATION_EXECUTION_CANCELLED: 'This automation execution has been cancelled.',
  AUTOMATION_EXECUTION_TIMED_OUT: 'This automation execution timed out.',
  AUTOMATION_RESULT_INVALID: 'Serpent received an invalid result from the automation command.',
};

function gatewayFailure(code: AutomationGatewayErrorCode): AutomationGatewayFailure {
  return { ok: false, error: { code, message: errorMessages[code] } };
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

export function createAutomationCommandGateway(
  workerClient: AutomationWorkerClient,
  executionResolver: AutomationExecutionResolver,
  options: AutomationCommandGatewayOptions = {},
): AutomationCommandGateway {
  const { auditSink, auditLogger, externalEffectHandler, filePlanApprovalHandler } = options;
  const inFlightCommandCounts = new Map<string, number>();
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

  return {
    async execute(envelope: unknown): Promise<AutomationGatewayResult> {
      const parsedEnvelope = automationCommandEnvelopeSchema.safeParse(envelope);
      if (!parsedEnvelope.success) return gatewayFailure('AUTOMATION_INVALID_REQUEST');

      const { apiVersion, commandId, executionId, input } = parsedEnvelope.data;
      if (apiVersion !== AUTOMATION_API_VERSION) {
        return gatewayFailure('AUTOMATION_API_VERSION_UNSUPPORTED');
      }

      const descriptor = getAutomationCommandDescriptor(commandId);
      if (!descriptor) return gatewayFailure('AUTOMATION_COMMAND_NOT_FOUND');
      let context: AutomationExecutionContext | undefined;
      try {
        context = await executionResolver.resolve(executionId);
      } catch (error) {
        auditLogger?.error('automation.execution.resolve-failed', error, { executionId });
        return { ok: false, error: toPublicError(error) };
      }
      if (!context || context.executionId !== executionId) {
        return gatewayFailure('AUTOMATION_EXECUTION_NOT_FOUND');
      }
      const recordOutcome = async (result: AutomationGatewayResult): Promise<AutomationGatewayResult> => {
        try {
          await auditSink?.recordCommandResult(
            executionId,
            descriptor.commandId,
            result.ok ? 'succeeded' : 'failed',
            result.ok ? undefined : result.error.code,
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
            ...(result.ok ? {} : { failureCode: result.error.code }),
          });
        }
        return result;
      };
      if (context.abortSignal?.aborted) {
        return cancellationFailure(context.abortSignal);
      }
      if (!isSourceAllowed(context.source, descriptor.allowedSources)) {
        return recordOutcome(gatewayFailure('AUTOMATION_SOURCE_NOT_ALLOWED'));
      }
      if (!hasCapabilities(context.grantedCapabilities, descriptor.requiredCapabilities)) {
        return recordOutcome(gatewayFailure('AUTOMATION_CAPABILITY_DENIED'));
      }

      const parsedInput = descriptor.inputSchema.safeParse(input);
      if (!parsedInput.success) return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));

      let approvedPlan: AutomationFileOperationPlanProof | undefined;
      if (descriptor.approvalPolicy === 'plan') {
        if (!filePlanApprovalHandler) {
          return recordOutcome({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
        try {
          approvedPlan = await filePlanApprovalHandler.prepareAndApprove({
            commandId: descriptor.commandId,
            executionId,
            libraryId: context.libraryId,
            commandInput: parsedInput.data,
          });
        } catch (error) {
          auditLogger?.error('automation.file-plan.failed', error, {
            executionId,
            commandId: descriptor.commandId,
          });
          return recordOutcome({ ok: false, error: toPublicError(error) });
        }
        // Cancellation is not an error: the script receives a stable public
        // result and no Worker mutation is dispatched.
        if (approvedPlan === undefined) {
          return recordOutcome({ ok: false, error: createPublicError('CANCELLED') });
        }
        if (context.abortSignal?.aborted) return recordOutcome(cancellationFailure(context.abortSignal));
      }
      if (!reserveCommandSlot(context)) {
        return recordOutcome(gatewayFailure('AUTOMATION_CONCURRENCY_LIMIT_REACHED'));
      }
      const recordOutcomeAndReleaseSlot = async (
        result: AutomationGatewayResult,
      ): Promise<AutomationGatewayResult> => {
        try {
          return await recordOutcome(result);
        } finally {
          // The slot represents the entire Gateway request, including schema
          // projection and durable execution audit, not merely Worker time.
          releaseCommandSlot(context);
        }
      };

      let workerResult: WorkerResult;
      try {
        workerResult = await workerClient.request(
          descriptor.toWorkerCommand(context.libraryId, parsedInput.data, approvedPlan),
          { signal: context.abortSignal, readonly: descriptor.impact === 'read' },
        );
      } catch (error) {
        if (context.abortSignal?.aborted) return recordOutcomeAndReleaseSlot(cancellationFailure(context.abortSignal));
        return recordOutcomeAndReleaseSlot({ ok: false, error: toPublicError(error) });
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
            libraryId: context.libraryId,
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

      const result = descriptor.projectResult(workerResult, context.libraryId, parsedInput.data);
      if (result === undefined || !descriptor.resultSchema.safeParse(result).success) {
        // library.inspect projects library.list down to the one library bound
        // to this execution. A missing entry is the same public state as a
        // Worker request against a library that is no longer open.
        if (descriptor.commandId === 'library.inspect') {
          return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('LIBRARY_NOT_OPEN') });
        }
        return recordOutcomeAndReleaseSlot(gatewayFailure('AUTOMATION_RESULT_INVALID'));
      }

      return recordOutcomeAndReleaseSlot({
        ok: true,
        apiVersion: AUTOMATION_API_VERSION,
        commandId: descriptor.commandId,
        executionId,
        result,
      });
    },
  };
}
