import type { IpcMain, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';

import type { AutomationCommandGateway } from '../automation/command-gateway';
import {
  automationScriptAssetSearchInputSchema,
  automationScriptCancelInputSchema,
  automationScriptCommandInputSchema,
  automationScriptCompleteInputSchema,
  automationScriptStartInputSchema,
  type AutomationScriptCommandResult,
  type AutomationScriptStartResult,
} from '../shared/automation-script-api';
import { parseSearchExpression } from '../shared/search-expression';
import { createPublicError, toPublicError } from '../shared/protocol/errors';
import type { PublicError } from '../shared/protocol/errors';
import {
  AUTOMATION_SCRIPT_CANCEL_CHANNEL,
  AUTOMATION_SCRIPT_COMMAND_CHANNEL,
  AUTOMATION_SCRIPT_COMPLETE_CHANNEL,
  AUTOMATION_SCRIPT_START_CHANNEL,
} from '../shared/protocol/channels';
import type { LibraryWorkerClient } from './worker-client';
import type { AutomationExecutionJournal } from './automation-execution-journal';

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
  confirmDesktopWrite(): Promise<boolean>;
  logger(): AppLogger | undefined;
}

/**
 * Renderer code never receives an automation execution context. Each command
 * is checked against Main-owned execution ownership and the journal resolves
 * its real library/capabilities before the Gateway builds a Worker request.
 */
export function registerAutomationScriptIpc(options: AutomationScriptIpcOptions): void {
  const owners = new Map<string, { senderId: number; sessionId: string }>();
  const sessionsBySender = new Map<number, string>();
  const observedSenders = new Set<number>();

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

  options.ipcMain.handle(AUTOMATION_SCRIPT_START_CHANNEL, async (event, input: unknown): Promise<AutomationScriptStartResult> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    observeSender(event.sender);
    const parsed = automationScriptStartInputSchema.safeParse(input);
    const worker = options.workerClient();
    const journal = options.journal();
    if (!parsed.success || !worker || !journal || !options.gateway()) {
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
      owners.set(created.executionId, { senderId: event.sender.id, sessionId });
      return { ok: true, executionId: created.executionId, logId: created.logId };
    } catch (error) {
      options.logger()?.error('automation.script.start-failed', error, { senderId: event.sender.id });
      return { ok: false, error: toPublicError(error) };
    }
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_COMMAND_CHANNEL, async (event, input: unknown): Promise<AutomationScriptCommandResult> => {
    if (!options.isAuthorizedSender(event.sender)) return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    const parsed = automationScriptCommandInputSchema.safeParse(input);
    const gateway = options.gateway();
    if (!parsed.success || !gateway || !owned(parsed.data.executionId, event.sender.id)) {
      return { ok: false, error: createPublicError('INTERNAL_ERROR') };
    }
    const commandInput = parsed.data.commandId === 'asset.search'
      ? (() => {
        const search = automationScriptAssetSearchInputSchema.safeParse(parsed.data.input);
        if (!search.success) return undefined;
        return {
          ...search.data,
          query: search.data.query === null ? null : parseSearchExpression(search.data.query),
        };
      })()
      : parsed.data.input;
    if (commandInput === undefined) {
      return { ok: false, error: createPublicError('INVALID_SEARCH_QUERY') };
    }
    const result = await gateway.execute({
      apiVersion: 1,
      commandId: parsed.data.commandId,
      executionId: parsed.data.executionId,
      input: commandInput,
    });
    if (!result.ok) {
      if (result.error.code.startsWith('AUTOMATION_')) {
        options.logger()?.info('automation.script.command-denied', 'Automation Gateway rejected a script command.', {
          executionId: parsed.data.executionId,
          commandId: parsed.data.commandId,
          code: result.error.code,
        });
        return { ok: false, error: createPublicError('INTERNAL_ERROR') };
      }
      return { ok: false, error: result.error as PublicError };
    }
    return { ok: true, result: result.result };
  });

  options.ipcMain.handle(AUTOMATION_SCRIPT_COMPLETE_CHANNEL, (event, input: unknown): void => {
    if (!options.isAuthorizedSender(event.sender)) return;
    const parsed = automationScriptCompleteInputSchema.safeParse(input);
    const journal = options.journal();
    if (!parsed.success || !journal || !owned(parsed.data.executionId, event.sender.id)) return;
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
