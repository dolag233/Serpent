import type { IpcMain, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';

import type { AutomationCommandGateway } from '../automation/command-gateway';
import {
  automationScriptAssetSearchInputSchema,
  automationScriptCancelInputSchema,
  automationScriptCommandInputSchema,
  automationScriptCompleteInputSchema,
  automationScriptExecuteInputSchema,
  automationScriptStartInputSchema,
  type AutomationScriptCommandResult,
  type AutomationScriptCommandId,
  type AutomationScriptExecuteResult,
  type AutomationScriptStartResult,
} from '../shared/automation-script-api';
import { parseSearchExpression } from '../shared/search-expression';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import type { PublicError } from '../shared/protocol/errors';
import {
  AUTOMATION_SCRIPT_CANCEL_CHANNEL,
  AUTOMATION_SCRIPT_COMMAND_CHANNEL,
  AUTOMATION_SCRIPT_COMPLETE_CHANNEL,
  AUTOMATION_SCRIPT_EXECUTE_CHANNEL,
  AUTOMATION_SCRIPT_START_CHANNEL,
} from '../shared/protocol/channels';
import type { LibraryWorkerClient } from './worker-client';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import type { ScriptRuntimeExecutor } from './script-runtime-supervisor';

type AppLogger = {
  error(scope: string, error: unknown, context?: Record<string, unknown>): void;
  info(scope: string, message: string, context?: Record<string, unknown>): void;
};

export interface AutomationScriptIpcOptions {
  ipcMain: IpcMain;
  isAuthorizedSender(sender: WebContents): boolean;
  workerClient(): LibraryWorkerClient | undefined;
  journal(): AutomationExecutionJournal | undefined;
  gateway(): AutomationCommandGateway | undefined;
  runtime(): ScriptRuntimeExecutor | undefined;
  confirmDesktopWrite(): Promise<boolean>;
  logger(): AppLogger | undefined;
}

/**
 * Renderer code never receives an automation execution context. Each command
 * is checked against Main-owned execution ownership and the journal resolves
 * its real library/capabilities before the Gateway builds a Worker request.
 */
export function registerAutomationScriptIpc(options: AutomationScriptIpcOptions): void {
  const owners = new Map<string, { senderId: number; sessionId: string; source: string }>();
  const sessionsBySender = new Map<number, string>();
  const observedSenders = new Set<number>();
  const runningRuntimeExecutionIds = new Set<string>();

  /**
   * A Console execution is only valid while its renderer session exists. This
   * covers renderer crashes, dev reloads and application shutdown paths that
   * cannot send the normal `complete`/`cancel` IPC request. `cancel` aborts
   * any Gateway wait through the journal-owned AbortSignal before the owner
   * entry is released.
   */
  const endSenderSession = (senderId: number): void => {
    sessionsBySender.delete(senderId);
    observedSenders.delete(senderId);
    const journal = options.journal();
    for (const [executionId, owner] of owners) {
      if (owner.senderId !== senderId) continue;
      journal?.cancel(executionId);
      owners.delete(executionId);
    }
  };

  const observeSender = (sender: WebContents): void => {
    if (observedSenders.has(sender.id)) return;
    observedSenders.add(sender.id);
    sender.once('destroyed', () => endSenderSession(sender.id));
  };

  const sessionFor = (senderId: number): string => {
    const existing = sessionsBySender.get(senderId);
    if (existing) return existing;
    const sessionId = randomUUID();
    sessionsBySender.set(senderId, sessionId);
    return sessionId;
  };

  const owned = (executionId: string, senderId: number): boolean => owners.get(executionId)?.senderId === senderId;

  /**
   * Every Sandbox → host call still goes through the same renderer-facing
   * command policy. Keeping this parsing beside the legacy explicit-command
   * endpoint prevents the two execution paths from drifting on search syntax,
   * Gateway errors, or authorization.
   */
  const executeOwnedCommand = async (
    executionId: string,
    commandId: AutomationScriptCommandId,
    rawInput: unknown,
  ): Promise<AutomationScriptCommandResult> => {
    const gateway = options.gateway();
    if (!gateway) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    const commandInput = commandId === 'asset.search'
      ? (() => {
        const search = automationScriptAssetSearchInputSchema.safeParse(rawInput);
        if (!search.success) return undefined;
        return {
          ...search.data,
          query: search.data.query === null ? null : parseSearchExpression(search.data.query),
        };
      })()
      : rawInput;
    if (commandInput === undefined) {
      return { ok: false, error: createPublicError('INVALID_SEARCH_QUERY') };
    }
    const result = await gateway.execute({
      apiVersion: 1,
      commandId,
      executionId,
      input: commandInput,
    });
    if (!result.ok) {
      if (result.error.code.startsWith('AUTOMATION_')) {
        options.logger()?.info('automation.script.command-denied', 'Automation Gateway rejected a script command.', {
          executionId,
          commandId,
          code: result.error.code,
        });
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      return { ok: false, error: result.error as PublicError };
    }
    return { ok: true, result: result.result };
  };

  options.ipcMain.handle(AUTOMATION_SCRIPT_START_CHANNEL, async (event, input: unknown): Promise<AutomationScriptStartResult> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    observeSender(event.sender);
    const parsed = automationScriptStartInputSchema.safeParse(input);
    const worker = options.workerClient();
    const journal = options.journal();
    if (!parsed.success || !worker || !journal || !options.gateway() || !options.runtime()) {
      return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    }
    try {
      const libraries = await worker.request({ type: 'library.list' });
      if (!libraries.ok || libraries.type !== 'library.list'
        || !libraries.libraries.some((library) => library.libraryId === parsed.data.libraryId)) {
        return { ok: false, error: createPublicError('LIBRARY_NOT_OPEN') };
      }
      // Console consent is per run. The sandbox cannot create an execution or
      // grant itself any capability; Main records the entire bounded surface
      // before the first command reaches the Gateway.
      if (!await options.confirmDesktopWrite()) return { ok: false, error: createPublicError('CANCELLED') };
      const sessionId = sessionFor(event.sender.id);
      const created = journal.create({
        source: 'desktop-console',
        libraryId: parsed.data.libraryId,
        scriptSource: parsed.data.source,
        sessionId,
        declaredCapabilities: [
          'library.read',
          'folder.read',
          'asset.read',
          'metadata.read',
          'metadata.write',
          'file.rename',
          'trash.write',
          'clipboard.write',
        ],
      });
      journal.start(created.executionId);
      const authorized = journal.authorizeFromDesktop({ executionId: created.executionId, persistence: 'session' });
      if (!authorized.ok) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      owners.set(created.executionId, { senderId: event.sender.id, sessionId, source: parsed.data.source });
      return { ok: true, executionId: created.executionId, logId: created.logId };
    } catch (error) {
      options.logger()?.error('automation.script.start-failed', error, { senderId: event.sender.id });
      return { ok: false, error: toPublicError(error) };
    }
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_EXECUTE_CHANNEL, async (event, input: unknown): Promise<AutomationScriptExecuteResult> => {
    if (!options.isAuthorizedSender(event.sender)) {
      return { ok: false, error: { code: 'RUNTIME_ERROR', message: 'The automation execution is unavailable.' } };
    }
    const parsed = automationScriptExecuteInputSchema.safeParse(input);
    const journal = options.journal();
    const runtime = options.runtime();
    if (!parsed.success || !journal || !runtime || !owned(parsed.data.executionId, event.sender.id)) {
      return { ok: false, error: { code: 'RUNTIME_ERROR', message: 'The automation execution is unavailable.' } };
    }
    const executionId = parsed.data.executionId;
    const owner = owners.get(executionId)!;
    if (runningRuntimeExecutionIds.has(executionId)) {
      return { ok: false, error: { code: 'RUNTIME_ERROR', message: 'The automation execution is already running.' } };
    }
    const context = journal.resolve(executionId);
    if (!context || !context.resourceBudget) {
      return { ok: false, error: { code: 'CANCELLED', message: 'The automation execution is no longer active.' } };
    }
    runningRuntimeExecutionIds.add(executionId);
    try {
      const result = await runtime.run({
        executionId,
        source: owner.source,
        signal: context.abortSignal,
        limits: {
          cpuTimeoutMs: context.resourceBudget.maxCpuTimeMs,
          wallTimeoutMs: context.resourceBudget.maxWallTimeMs,
          memoryLimitBytes: context.resourceBudget.maxMemoryBytes,
          maxOutputBytes: context.resourceBudget.maxOutputBytes,
          maxPendingHostCalls: context.resourceBudget.maxConcurrentCommands,
          maxPendingGuestPromises: context.resourceBudget.maxPendingPromises,
        },
        host: {
          execute: async (commandId, commandInput) => {
            const command = await executeOwnedCommand(executionId, commandId, commandInput);
            if (!command.ok) throw new Error(command.error.message);
            return command.result;
          },
        },
      });
      const record = journal.get(executionId);
      if (record?.status === 'running' || record?.status === 'awaiting-approval') {
        if (result.ok) {
          journal.complete(executionId, {
            status: record.failedCommandCount > 0 ? 'partially-succeeded' : 'succeeded',
            summary: { succeeded: record.succeededCommandCount, failed: record.failedCommandCount },
          });
        } else if (result.error.code === 'CANCELLED') {
          journal.cancel(executionId);
        } else if (result.error.code === 'WALL_TIMEOUT') {
          journal.complete(executionId, {
            status: 'timed-out',
            failureCode: 'AUTOMATION_TIMED_OUT',
            summary: { succeeded: record.succeededCommandCount, failed: record.failedCommandCount },
          });
        } else {
          journal.complete(executionId, {
            status: 'failed',
            summary: { succeeded: record.succeededCommandCount, failed: record.failedCommandCount },
          });
        }
      }
      return result.ok
        ? { ok: true, value: result.value, output: result.output }
        : { ok: false, error: result.error };
    } catch (error) {
      options.logger()?.error('automation.script.runtime-failed', error, { executionId });
      const record = journal.get(executionId);
      if (record?.status === 'running' || record?.status === 'awaiting-approval') {
        journal.complete(executionId, {
          status: 'failed',
          summary: { succeeded: record.succeededCommandCount, failed: record.failedCommandCount },
        });
      }
      return { ok: false, error: { code: 'RUNTIME_ERROR', message: 'The isolated script runtime could not complete.' } };
    } finally {
      runningRuntimeExecutionIds.delete(executionId);
      owners.delete(executionId);
    }
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_COMMAND_CHANNEL, async (event, input: unknown): Promise<AutomationScriptCommandResult> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    const parsed = automationScriptCommandInputSchema.safeParse(input);
    if (!parsed.success || !owned(parsed.data.executionId, event.sender.id)) {
      return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    }
    return executeOwnedCommand(parsed.data.executionId, parsed.data.commandId, parsed.data.input);
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_COMPLETE_CHANNEL, (event, input: unknown): void => {
    if (!options.isAuthorizedSender(event.sender)) return;
    const parsed = automationScriptCompleteInputSchema.safeParse(input);
    const journal = options.journal();
    if (!parsed.success || !journal || !owned(parsed.data.executionId, event.sender.id)
      || runningRuntimeExecutionIds.has(parsed.data.executionId)) return;
    const record = journal.get(parsed.data.executionId);
    if (!record) return;
    journal.complete(parsed.data.executionId, {
      status: parsed.data.cancelled ? 'cancelled' : (parsed.data.succeeded ? 'succeeded' : 'failed'),
      summary: {
        succeeded: record.succeededCommandCount,
        failed: record.failedCommandCount,
      },
    });
    owners.delete(parsed.data.executionId);
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_CANCEL_CHANNEL, (event, input: unknown): void => {
    if (!options.isAuthorizedSender(event.sender)) return;
    const parsed = automationScriptCancelInputSchema.safeParse(input);
    const journal = options.journal();
    if (!parsed.success || !journal || !owned(parsed.data.executionId, event.sender.id)) return;
    journal.cancel(parsed.data.executionId);
    owners.delete(parsed.data.executionId);
  });
}
