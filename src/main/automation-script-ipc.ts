import type { IpcMain, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';

import type { AutomationCommandGateway } from '../automation/command-gateway';
import {
  automationScriptCancelInputSchema,
  automationScriptCommandInputSchema,
  automationScriptCompleteInputSchema,
  automationScriptExecuteInputSchema,
  automationScriptHistoryInputSchema,
  automationScriptUndoInputSchema,
  automationScriptSaveInputSchema,
  automationScriptStartInputSchema,
  automationRecentScriptOpenInputSchema,
  type AutomationScriptCommandResult,
  type AutomationScriptCommandId,
  type AutomationScriptExecuteResult,
  type AutomationScriptHistoryResult,
  type AutomationScriptStartResult,
  type AutomationScriptUndoResult,
  type AutomationRecentScriptsListResult,
} from '../shared/automation-script-api';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import {
  automationScriptHostErrorSchema,
  AutomationScriptHostCommandError,
} from '../shared/automation-host-command-error';
import {
  AUTOMATION_SCRIPT_OPEN_CHANNEL,
  AUTOMATION_SCRIPT_SAVE_CHANNEL,
  AUTOMATION_SCRIPT_CANCEL_CHANNEL,
  AUTOMATION_SCRIPT_COMMAND_CHANNEL,
  AUTOMATION_SCRIPT_COMPLETE_CHANNEL,
  AUTOMATION_SCRIPT_EXECUTE_CHANNEL,
  AUTOMATION_SCRIPT_HISTORY_CHANNEL,
  AUTOMATION_SCRIPT_START_CHANNEL,
  AUTOMATION_SCRIPT_UNDO_CHANNEL,
  AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL,
  AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL,
} from '../shared/protocol/channels';
import type { LibraryWorkerClient } from './worker-client';
import type { AutomationExecutionJournal } from './automation-execution-journal';
import type { ScriptRuntimeExecutor } from './script-runtime-supervisor';
import type { AutomationScriptFileService } from './automation-script-file-service';
import { normalizeAutomationAssetSearchInput } from './normalize-automation-asset-search-input';

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
  scriptFiles?(): AutomationScriptFileService | undefined;
  confirmDesktopWrite(): Promise<boolean>;
  logger(): AppLogger | undefined;
  undoGroup?(): AutomationUndoRecoveryHandler | undefined;
}

export interface AutomationUndoRecoveryHandler {
  recover(input: {
    undoGroupId: string;
    libraryId: string;
    items: readonly { kind: string; reference: string; reversible: boolean }[];
  }): Promise<{ undoneCount: number; skippedCount: number }>;
}

/**
 * Renderer code never receives an automation execution context. Each command
 * is checked against Main-owned execution ownership and the journal resolves
 * its real library/capabilities before the Gateway builds a Worker request.
 */
export function registerAutomationScriptIpc(options: AutomationScriptIpcOptions): void {
  const owners = new Map<string, { senderId: number; source: string }>();
  const completedOwners = new Map<string, number>();
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
    options.scriptFiles?.()?.releaseSender(senderId);
    const journal = options.journal();
    for (const [executionId, owner] of owners) {
      if (owner.senderId !== senderId) continue;
      journal?.cancel(executionId);
      owners.delete(executionId);
    }
    for (const [executionId, ownerSenderId] of completedOwners) {
      if (ownerSenderId === senderId) completedOwners.delete(executionId);
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

  options.ipcMain.handle(AUTOMATION_SCRIPT_OPEN_CHANNEL, async (event): Promise<unknown> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, code: 'io-failed' };
    observeSender(event.sender);
    const files = options.scriptFiles?.();
    return files ? files.open(event.sender.id) : { ok: false, code: 'io-failed' };
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_SAVE_CHANNEL, async (event, input: unknown): Promise<unknown> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, code: 'io-failed' };
    observeSender(event.sender);
    const parsed = automationScriptSaveInputSchema.safeParse(input);
    const files = options.scriptFiles?.();
    if (!parsed.success || !files) return { ok: false, code: 'io-failed' };
    return files.save({ senderId: event.sender.id, source: parsed.data.source });
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL, (event): AutomationRecentScriptsListResult => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, code: 'io-failed' };
    observeSender(event.sender);
    const files = options.scriptFiles?.();
    if (!files) return { ok: false, code: 'io-failed' };
    return { ok: true, entries: files.listRecent() };
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL, async (event, input: unknown): Promise<unknown> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, code: 'io-failed' };
    observeSender(event.sender);
    const parsed = automationRecentScriptOpenInputSchema.safeParse(input);
    const files = options.scriptFiles?.();
    if (!parsed.success || !files) return { ok: false, code: 'io-failed' };
    return files.openRecent(event.sender.id, parsed.data.handle);
  });

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
      ? normalizeAutomationAssetSearchInput(rawInput)
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
      const failure = automationScriptHostErrorSchema.safeParse(result.error);
      if (!failure.success) {
        options.logger()?.error('automation.script.invalid-command-error', failure.error, {
          executionId,
          commandId,
        });
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      return { ok: false, error: failure.data };
    }
    return {
      ok: true,
      result: result.result,
      ...(result.undoGroupId === undefined ? {} : { undoGroupId: result.undoGroupId }),
    };
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
      if (parsed.data.libraryId !== null) {
        const libraries = await worker.request({ type: 'library.list' });
        if (!libraries.ok || libraries.type !== 'library.list'
          || !libraries.libraries.some((library) => library.libraryId === parsed.data.libraryId)) {
          return { ok: false, error: createPublicError('LIBRARY_NOT_OPEN') };
        }
      }
      const savedScript = parsed.data.scriptId === undefined
        ? undefined
        : options.scriptFiles?.()?.resolveForExecution({
          senderId: event.sender.id,
          scriptId: parsed.data.scriptId,
          source: parsed.data.source,
        });
      if (parsed.data.scriptId !== undefined && savedScript === undefined) {
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      const source = savedScript === undefined ? 'desktop-console' : 'script';
      const sessionId = source === 'desktop-console' ? sessionFor(event.sender.id) : undefined;
      const declaredCapabilities = [
        'library.read',
        'folder.read',
        'folder.write',
        'asset.read',
        'metadata.read',
        'tag.read',
        'tag.write',
        'collection.read',
        'collection.write',
        'job.read',
        'ai.enqueue',
        'metadata.write',
        'file.rename',
        'file.move',
        'trash.write',
        'clipboard.write',
        'library.create',
        'file.import',
        'ui.notify',
      ] as const;
      const created = journal.create({
        source,
        libraryId: parsed.data.libraryId,
        scriptSource: parsed.data.source,
        ...(sessionId === undefined ? {} : { sessionId }),
        declaredCapabilities,
      });
      const started = journal.start(created.executionId);
      if (started?.status === 'awaiting-authorization') {
        // Main creates an auditable execution before asking the user. If the
        // dialog is declined it is explicitly cancelled rather than silently
        // vanishing; saved scripts retain a grant only after this confirmation.
        if (!await options.confirmDesktopWrite()) {
          journal.cancel(created.executionId);
          return { ok: false, error: createPublicError('CANCELLED') };
        }
        const authorized = journal.authorizeFromDesktop({
          executionId: created.executionId,
          persistence: source === 'script' ? 'saved-script' : 'session',
        });
        if (!authorized.ok) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      if (journal.get(created.executionId)?.status !== 'running') {
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      owners.set(created.executionId, { senderId: event.sender.id, source: parsed.data.source });
      return {
        ok: true,
        executionId: created.executionId,
        logId: created.logId,
        capabilities: [...declaredCapabilities],
      };
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
            if (!command.ok) throw new AutomationScriptHostCommandError(command.error);
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
      completedOwners.set(executionId, event.sender.id);
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
    completedOwners.set(parsed.data.executionId, event.sender.id);
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

  options.ipcMain.handle(
    AUTOMATION_SCRIPT_UNDO_CHANNEL,
    async (event, input: unknown): Promise<AutomationScriptUndoResult> => {
      if (!options.isAuthorizedSender(event.sender)) {
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      const parsed = automationScriptUndoInputSchema.safeParse(input);
      const journal = options.journal();
      const recovery = options.undoGroup?.();
      if (!parsed.success || !journal || !recovery) {
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      const senderId = owners.get(parsed.data.executionId)?.senderId
        ?? completedOwners.get(parsed.data.executionId);
      if (senderId !== event.sender.id) {
        return { ok: false, error: createPublicError('AUTOMATION_UNDO_GROUP_NOT_FOUND') };
      }
      const group = parsed.data.undoGroupId === undefined
        ? journal.listUndoGroups()
          .filter((candidate) => candidate.executionId === parsed.data.executionId)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
        : journal.getUndoGroup(parsed.data.undoGroupId);
      if (!group || group.executionId !== parsed.data.executionId) {
        return { ok: false, error: createPublicError('AUTOMATION_UNDO_GROUP_NOT_FOUND') };
      }
      if (!group.undoable) {
        return { ok: false, error: createPublicError('AUTOMATION_UNDO_NOT_AVAILABLE') };
      }
      try {
        const result = await recovery.recover({
          undoGroupId: group.undoGroupId,
          libraryId: group.libraryId,
          items: group.items,
        });
        journal.consumeUndoGroup(group.undoGroupId);
        return { ok: true, undoGroupId: group.undoGroupId, ...result };
      } catch (error) {
        options.logger()?.error('automation.undo.failed', error, {
          executionId: group.executionId,
          undoGroupId: group.undoGroupId,
        });
        return { ok: false, error: createPublicError('AUTOMATION_UNDO_STALE') };
      }
    },
  );

  options.ipcMain.handle(
    AUTOMATION_SCRIPT_HISTORY_CHANNEL,
    (event, input: unknown): AutomationScriptHistoryResult => {
      if (!options.isAuthorizedSender(event.sender)) {
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      const parsed = automationScriptHistoryInputSchema.safeParse(input);
      const journal = options.journal();
      if (!parsed.success || !journal) {
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      const entries = journal.list(parsed.data.libraryId)
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, parsed.data.limit)
        .map((record) => ({
          executionId: record.executionId,
          logId: record.logId,
          source: record.source,
          status: record.status,
          commandCount: record.commandCount,
          succeededCommandCount: record.succeededCommandCount,
          failedCommandCount: record.failedCommandCount,
          failureCode: record.failureCode,
          createdAt: record.createdAt,
          finishedAt: record.finishedAt,
        }));
      return { ok: true, entries };
    },
  );
}
