import { createHash } from 'node:crypto';
import { z } from 'zod';

import {
  AUTOMATION_API_VERSION,
  automationCapabilitySchema,
  automationSourceSchema,
  getAutomationCommandDescriptor,
  type AutomationCapability,
  type AutomationCommandId,
  type AutomationCommandInput,
  type AutomationCommandResult,
  type AutomationFileOperationPlanProof,
  type AutomationSource,
} from './command-registry';
import type { PublicError } from '../shared/protocol/errors';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import { PluginHookBlockedError } from '../plugins/plugin-hooks';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';

const nonBlankString = z.string().min(1).refine((value) => value.trim().length > 0, {
  message: 'Value must not be blank.',
});
const idempotencyKeySchema = nonBlankString.max(128);

export const automationExecutionContextSchema = z.strictObject({
  executionId: nonBlankString.max(255),
  source: automationSourceSchema,
  libraryId: nonBlankString.max(255).nullable(),
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
  | 'AUTOMATION_LIBRARY_NOT_BOUND'
  | 'AUTOMATION_LIBRARY_OPEN_FAILED'
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
  undoGroupId?: string;
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
    libraryId: string | null;
    commandInput: unknown;
  }): Promise<AutomationFileOperationPlanProof | undefined>;
}

export interface AutomationLibraryBindingHandler {
  bindLibrary(input: { executionId: string; libraryId: string }): void | Promise<void>;
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

export interface AutomationCommandGatewayOptions {
  auditSink?: AutomationExecutionAuditSink;
  auditLogger?: AutomationGatewayAuditLogger;
  externalEffectHandler?: AutomationExternalEffectHandler;
  filePlanApprovalHandler?: AutomationFilePlanApprovalHandler;
  libraryBindingHandler?: AutomationLibraryBindingHandler;
  executionStatusHandler?: AutomationExecutionStatusHandler;
  uiNotifyHandler?: AutomationUiNotifyHandler;
  undoGroupHandler?: AutomationUndoGroupHandler;
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
  AUTOMATION_LIBRARY_NOT_BOUND: 'This automation execution must open and bind a library before calling this command.',
  AUTOMATION_LIBRARY_OPEN_FAILED: 'The created library could not be opened and bound to this automation execution.',
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
    executionStatusHandler,
    uiNotifyHandler,
    undoGroupHandler,
  } = options;
  const inFlightCommandCounts = new Map<string, number>();
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
      const idempotencyEntryKey = idempotencyKey === undefined
        ? undefined
        : `${executionId}\u0000${descriptor.commandId}\u0000${idempotencyKey}`;
      if (context.libraryId === null
        && descriptor.commandId !== 'library.create'
        && descriptor.commandId !== 'ui.notify') {
        return recordOutcome(gatewayFailure('AUTOMATION_LIBRARY_NOT_BOUND'));
      }
      if (descriptor.commandId === 'library.create' && libraryBindingHandler === undefined) {
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
        const existing = idempotencyEntries.get(idempotencyEntryKey);
        if (existing !== undefined) {
          if (existing.fingerprint !== fingerprint) {
            return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
          }
          return existing.promise;
        }
        if (descriptor.commandId === 'library.create' && context.libraryId !== null) {
          return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
        }
        let resolveEntry!: (result: AutomationGatewayResult) => void;
        const promise = new Promise<AutomationGatewayResult>((resolve) => {
          resolveEntry = resolve;
        });
        idempotencyEntry = { fingerprint, promise, resolve: resolveEntry };
        idempotencyEntries.set(idempotencyEntryKey, idempotencyEntry);
      }
      if (descriptor.commandId === 'library.create' && context.libraryId !== null) {
        return recordOutcome(gatewayFailure('AUTOMATION_INVALID_REQUEST'));
      }
      const completeIdempotency = (result: AutomationGatewayResult): void => {
        if (idempotencyEntry === undefined || idempotencyEntryKey === undefined) return;
        if (!result.ok) idempotencyEntries.delete(idempotencyEntryKey);
        idempotencyEntry.resolve(result);
      };
      const recordIdempotentOutcome = async (result: AutomationGatewayResult): Promise<AutomationGatewayResult> => {
        const completed = await recordOutcome(result);
        completeIdempotency(completed);
        return completed;
      };
      const boundLibraryId = context.libraryId;

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
      if (descriptor.supportsUndo && undoGroupHandler !== undefined) {
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
            else {
              undoGroupHandler.complete({
                undoGroupId,
                status: 'failed',
                failureReason: result.error.message,
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
      try {
        workerResult = await workerClient.request(
          descriptor.toWorkerCommand(boundLibraryId ?? '', parsedInput.data, approvedPlan),
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

      if (descriptor.commandId === 'library.create') {
        const createdLibrary = result as { libraryId?: unknown };
        if (typeof createdLibrary.libraryId !== 'string') {
          return recordOutcomeAndReleaseSlot(gatewayFailure('AUTOMATION_RESULT_INVALID'));
        }
        if (libraryBindingHandler === undefined) {
          return recordOutcomeAndReleaseSlot({ ok: false, error: createPublicError('INTERNAL_ERROR') });
        }
        try {
          await libraryBindingHandler.bindLibrary({
            executionId,
            libraryId: createdLibrary.libraryId,
          });
        } catch (error) {
          auditLogger?.error('automation.library-bind.failed', error, { executionId });
          return recordOutcomeAndReleaseSlot(gatewayFailure('AUTOMATION_LIBRARY_OPEN_FAILED'));
        }
      }

      return recordOutcomeAndReleaseSlot({
        ok: true,
        apiVersion: AUTOMATION_API_VERSION,
        commandId: descriptor.commandId,
        executionId,
        result,
        ...(undoGroupId === undefined ? {} : { undoGroupId }),
      });
    },
  };
}
