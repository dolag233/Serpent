import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createAutomationCommandGateway,
  type AutomationWorkerClient,
} from '../../src/automation/command-gateway';
import {
  AutomationExecutionJournal,
  AutomationExecutionJournalError,
  DEFAULT_AUTOMATION_EXECUTION_RESOURCE_BUDGET,
  createJsonFileAutomationExecutionStore,
  type AutomationExecutionAuditLogger,
} from '../../src/main/automation-execution-journal';
import { AppLogger } from '../../src/main/app-logger';

const roots: string[] = [];
const libraryOne = '11111111-1111-4111-8111-111111111111';
const libraryTwo = '22222222-2222-4222-8222-222222222222';
const consoleSessionOne = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mcpSessionOne = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const mcpSessionTwo = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const silentLogger: AutomationExecutionAuditLogger = {
  info: () => undefined,
  error: () => undefined,
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function journalFile(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-executions-'));
  roots.push(root);
  return path.join(root, 'automation-executions.json');
}

function createJournal(
  filename = journalFile(),
  logger: AutomationExecutionAuditLogger = silentLogger,
  options: Partial<ConstructorParameters<typeof AutomationExecutionJournal>[0]> = {},
): AutomationExecutionJournal {
  return new AutomationExecutionJournal({
    store: createJsonFileAutomationExecutionStore(filename),
    clock: () => new Date('2026-07-29T12:00:00.000Z'),
    newId: (() => {
      let index = 0;
      return (prefix) => `${prefix}-${++index}`;
    })(),
    ...options,
    logger: options.logger ?? logger,
  });
}

describe('AutomationExecutionJournal', () => {
  it('persists every terminal outcome with a stable status and failure code', () => {
    const journal = createJournal();
    const start = (): string => {
      const execution = journal.create({
        source: 'mcp',
        libraryId: libraryOne,
        sessionId: mcpSessionOne,
        declaredCapabilities: ['asset.read'],
      });
      journal.start(execution.executionId);
      journal.authorizeFromDesktop({ executionId: execution.executionId, persistence: 'session' });
      return execution.executionId;
    };

    const succeeded = start();
    const partiallySucceeded = start();
    const failed = start();
    const cancelled = start();
    const timedOut = start();
    journal.complete(succeeded, { status: 'succeeded', summary: { succeeded: 1 } });
    journal.complete(partiallySucceeded, { status: 'partially-succeeded', summary: { succeeded: 1, failed: 1 } });
    journal.complete(failed, { status: 'failed' });
    journal.cancel(cancelled);
    journal.timeout(timedOut);

    expect(journal.get(succeeded)).toMatchObject({ status: 'succeeded', failureCode: null, finishedAt: expect.any(String) });
    expect(journal.get(partiallySucceeded)).toMatchObject({ status: 'partially-succeeded', failureCode: null, finishedAt: expect.any(String) });
    expect(journal.get(failed)).toMatchObject({ status: 'failed', failureCode: 'AUTOMATION_COMMAND_FAILED' });
    expect(journal.get(cancelled)).toMatchObject({ status: 'cancelled', failureCode: 'AUTOMATION_CANCELLED' });
    expect(journal.get(timedOut)).toMatchObject({ status: 'timed-out', failureCode: 'AUTOMATION_TIMED_OUT' });
  });

  it('requires a Desktop Console session grant before exposing its bound library capabilities', () => {
    const journal = createJournal();
    const execution = journal.create({
      source: 'desktop-console',
      libraryId: libraryOne,
      sessionId: consoleSessionOne,
      scriptSource: "return await serpent.assets.search({ query: 'Ser' });",
      declaredCapabilities: ['asset.read', 'metadata.read'],
    });

    expect(execution.status).toBe('created');
    expect(journal.resolve(execution.executionId)).toBeUndefined();
    expect(journal.validate(execution.executionId)).toMatchObject({ status: 'validating' });
    expect(journal.finishValidation(execution.executionId)).toMatchObject({ status: 'awaiting-authorization' });

    expect(journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'session',
    })).toMatchObject({ ok: true, execution: { status: 'running' } });

    const context = journal.resolve(execution.executionId);
    expect(context).toEqual({
      executionId: execution.executionId,
      source: 'desktop-console',
      libraryId: libraryOne,
      grantedCapabilities: ['asset.read', 'metadata.read'],
      logId: execution.logId,
      deadlineAt: '2026-07-29T12:01:00.000Z',
      resourceBudget: {
        maxWallTimeMs: 60_000,
        maxCpuTimeMs: 10_000,
        maxMemoryBytes: 64 * 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxConcurrentCommands: 4,
        maxPendingPromises: 128,
      },
      abortSignal: expect.any(AbortSignal),
    });

    expect(journal.requestApproval(execution.executionId)).toMatchObject({ status: 'awaiting-approval' });
    expect(journal.approve(execution.executionId)).toMatchObject({ status: 'running' });

    journal.endSession(consoleSessionOne);

    expect(journal.resolve(execution.executionId)).toBeUndefined();
    expect(journal.get(execution.executionId)).toMatchObject({ status: 'cancelled' });
    expect(context?.abortSignal?.aborted).toBe(true);
  });

  it('persists saved-script authorization only for the exact code hash, library, and declared capabilities', () => {
    const filename = journalFile();
    const originalSource = "return await serpent.assets.search({ query: 'Ser' });";
    const firstJournal = createJournal(filename);
    const first = firstJournal.create({
      source: 'script',
      libraryId: libraryOne,
      scriptSource: originalSource,
      declaredCapabilities: ['asset.read', 'metadata.write'],
    });

    firstJournal.start(first.executionId);
    expect(firstJournal.authorizeFromDesktop({
      executionId: first.executionId,
      persistence: 'saved-script',
    })).toMatchObject({ ok: true, execution: { status: 'running' } });
    firstJournal.complete(first.executionId, { status: 'succeeded', summary: { updated: 3 } });

    const reloaded = createJournal(filename);
    const sameScript = reloaded.create({
      source: 'script',
      libraryId: libraryOne,
      scriptSource: originalSource,
      declaredCapabilities: ['asset.read', 'metadata.write'],
    });
    const changedSource = reloaded.create({
      source: 'script',
      libraryId: libraryOne,
      scriptSource: `${originalSource}\n// changed`,
      declaredCapabilities: ['asset.read', 'metadata.write'],
    });
    const changedLibrary = reloaded.create({
      source: 'script',
      libraryId: libraryTwo,
      scriptSource: originalSource,
      declaredCapabilities: ['asset.read', 'metadata.write'],
    });
    const changedCapabilities = reloaded.create({
      source: 'script',
      libraryId: libraryOne,
      scriptSource: originalSource,
      declaredCapabilities: ['asset.read', 'metadata.write', 'tag.write'],
    });

    expect(reloaded.start(sameScript.executionId)).toMatchObject({ status: 'running' });
    expect(reloaded.start(changedSource.executionId)).toMatchObject({ status: 'awaiting-authorization' });
    expect(reloaded.start(changedLibrary.executionId)).toMatchObject({ status: 'awaiting-authorization' });
    expect(reloaded.start(changedCapabilities.executionId)).toMatchObject({ status: 'awaiting-authorization' });
  });

  it('does not expose a caller-supplied actor field that an MCP client could forge into a Desktop grant', () => {
    const journal = createJournal();
    const execution = journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionOne,
      declaredCapabilities: ['asset.read'],
    });

    journal.start(execution.executionId);
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(journal))).not.toContain('authorize');
    expect(journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'saved-script',
    })).toEqual({ ok: false, code: 'AUTOMATION_GRANT_NOT_ALLOWED' });
    expect(journal.resolve(execution.executionId)).toBeUndefined();
  });

  it('allows a Desktop user to issue only a session-scoped MCP grant', () => {
    const journal = createJournal();
    const execution = journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionOne,
      declaredCapabilities: ['asset.read'],
    });

    journal.start(execution.executionId);
    expect(journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'session',
    })).toMatchObject({ ok: true, execution: { status: 'running' } });
    expect(journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'saved-script',
    })).toEqual({ ok: false, code: 'AUTOMATION_GRANT_NOT_ALLOWED' });
  });

  it('recovers interrupted executions after restart without persisting script text or secrets', () => {
    const filename = journalFile();
    const entries: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const logger: AutomationExecutionAuditLogger = {
      info: (scope, _message, context) => entries.push({ scope, context }),
      error: (scope, _error, context) => entries.push({ scope, context }),
    };
    const firstJournal = createJournal(filename, logger);
    const execution = firstJournal.create({
      source: 'desktop-console',
      libraryId: libraryOne,
      sessionId: consoleSessionOne,
      scriptSource: "const apiKey = 'sk-secret-should-not-persist'; return 1;",
      declaredCapabilities: ['asset.read'],
    });
    firstJournal.start(execution.executionId);
    firstJournal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'session',
    });

    const restarted = createJournal(filename, logger);

    expect(restarted.get(execution.executionId)).toMatchObject({
      status: 'failed',
      failureCode: 'AUTOMATION_INTERRUPTED_BY_RESTART',
    });
    expect(restarted.resolve(execution.executionId)).toBeUndefined();
    expect(readFileSync(filename, 'utf8')).not.toContain('sk-secret-should-not-persist');
    expect(JSON.stringify(entries)).not.toContain('sk-secret-should-not-persist');
    expect(entries.some((entry) => entry.scope === 'automation.execution.interrupted')).toBe(true);
  });

  it('refuses arbitrary failure text so paths and secrets cannot enter execution history', () => {
    const filename = journalFile();
    const journal = createJournal(filename);
    const execution = journal.create({
      source: 'desktop-console',
      libraryId: libraryOne,
      sessionId: consoleSessionOne,
      scriptSource: 'return 1;',
      declaredCapabilities: ['asset.read'],
    });
    journal.start(execution.executionId);
    journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'session',
    });

    expect(() => journal.complete(execution.executionId, {
      status: 'failed',
      failureCode: 'Could not read /Users/artist/private.png with sk-secret-should-not-persist' as never,
    })).toThrow();
    expect(readFileSync(filename, 'utf8')).not.toContain('sk-secret-should-not-persist');
    expect(journal.get(execution.executionId)).toMatchObject({ status: 'running' });
  });

  it('rejects path-shaped library input before it can reach journal storage or the application logger', () => {
    const filename = journalFile();
    const entries: Array<{ scope: string; context?: Record<string, unknown> }> = [];
    const logger: AutomationExecutionAuditLogger = {
      info: (scope, _message, context) => entries.push({ scope, context }),
      error: (scope, _error, context) => entries.push({ scope, context }),
    };
    const journal = createJournal(filename, logger);
    journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionOne,
      declaredCapabilities: ['asset.read'],
    });

    expect(() => journal.create({
      source: 'mcp',
      libraryId: '/Users/artist/Private Library.serpent',
      sessionId: mcpSessionTwo,
      declaredCapabilities: ['asset.read'],
    })).toThrow();
    expect(readFileSync(filename, 'utf8')).not.toContain('/Users/artist/Private Library.serpent');
    expect(JSON.stringify(entries)).not.toContain('/Users/artist/Private Library.serpent');
  });

  it('keeps a bounded number of active executions so the history store cannot be exhausted', () => {
    const journal = createJournal(undefined, undefined, { maxActiveExecutions: 1 });
    journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionOne,
      declaredCapabilities: ['asset.read'],
    });

    expect(() => journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionTwo,
      declaredCapabilities: ['asset.read'],
    })).toThrow(new AutomationExecutionJournalError('AUTOMATION_EXECUTION_LIMIT_REACHED'));
    expect(journal.list()).toHaveLength(1);
  });

  it('trims completed execution history before the JSON snapshot reaches its storage ceiling', () => {
    const journal = createJournal(undefined, undefined, {
      historyLimit: 2,
      maxActiveExecutions: 1,
    });
    const complete = (sessionId: string): string => {
      const execution = journal.create({
        source: 'mcp',
        libraryId: libraryOne,
        sessionId,
        declaredCapabilities: ['asset.read'],
      });
      journal.start(execution.executionId);
      journal.authorizeFromDesktop({ executionId: execution.executionId, persistence: 'session' });
      journal.complete(execution.executionId, { status: 'succeeded' });
      return execution.executionId;
    };

    const first = complete(mcpSessionOne);
    const second = complete(mcpSessionTwo);
    const third = complete(consoleSessionOne);

    expect(journal.list().map((record) => record.executionId)).toEqual([second, third]);
    expect(journal.get(first)).toBeUndefined();
  });

  it('trims old saved-script grants so a full grant store fails closed and requires reauthorization', () => {
    const filename = journalFile();
    const firstJournal = createJournal(filename, undefined, { persistentGrantLimit: 2 });
    const authorizeSavedScript = (source: string): void => {
      const execution = firstJournal.create({
        source: 'script',
        libraryId: libraryOne,
        scriptSource: source,
        declaredCapabilities: ['asset.read'],
      });
      firstJournal.start(execution.executionId);
      firstJournal.authorizeFromDesktop({
        executionId: execution.executionId,
        persistence: 'saved-script',
      });
      firstJournal.complete(execution.executionId, { status: 'succeeded' });
    };
    authorizeSavedScript('return 1;');
    authorizeSavedScript('return 2;');
    authorizeSavedScript('return 3;');

    const reloaded = createJournal(filename, undefined, { persistentGrantLimit: 2 });
    const expired = reloaded.create({
      source: 'script',
      libraryId: libraryOne,
      scriptSource: 'return 1;',
      declaredCapabilities: ['asset.read'],
    });
    const retained = reloaded.create({
      source: 'script',
      libraryId: libraryOne,
      scriptSource: 'return 3;',
      declaredCapabilities: ['asset.read'],
    });

    expect(reloaded.start(expired.executionId)).toMatchObject({ status: 'awaiting-authorization' });
    expect(reloaded.start(retained.executionId)).toMatchObject({ status: 'running' });
  });

  it('persists a wall-clock budget and aborts a running execution when its deadline expires', async () => {
    const journal = createJournal(undefined, undefined, {
      resourceBudget: {
        ...DEFAULT_AUTOMATION_EXECUTION_RESOURCE_BUDGET,
        maxWallTimeMs: 1,
      },
    });
    const execution = journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionOne,
      declaredCapabilities: ['asset.read'],
    });
    journal.start(execution.executionId);
    journal.authorizeFromDesktop({ executionId: execution.executionId, persistence: 'session' });
    const context = journal.resolve(execution.executionId);

    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(journal.get(execution.executionId)).toMatchObject({
      status: 'timed-out',
      failureCode: 'AUTOMATION_TIMED_OUT',
      resourceBudget: { maxWallTimeMs: 1 },
    });
    expect(context?.abortSignal?.aborted).toBe(true);
    expect(context?.abortSignal?.reason).toBe('timed-out');
  });

  it('records stable command failures in the persistent application log with execution and log IDs', () => {
    const filename = journalFile();
    const logger = new AppLogger(path.join(path.dirname(filename), 'serpent.log'));
    const journal = createJournal(filename, logger);
    const execution = journal.create({
      source: 'mcp',
      libraryId: libraryOne,
      sessionId: mcpSessionOne,
      declaredCapabilities: ['asset.read'],
    });
    journal.start(execution.executionId);
    journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'session',
    });

    journal.recordCommandResult(
      execution.executionId,
      'asset.search',
      'failed',
      'AUTOMATION_CAPABILITY_DENIED',
    );

    expect(logger.readRecent().at(-1)).toMatchObject({
      scope: 'automation.execution.command',
      context: {
        executionId: execution.executionId,
        logId: execution.logId,
        failureCode: 'AUTOMATION_CAPABILITY_DENIED',
        commandId: 'asset.search',
        outcome: 'failed',
      },
    });
  });

  it('records Gateway command outcomes against the active execution without changing the command result', async () => {
    const journal = createJournal();
    const execution = journal.create({
      source: 'desktop-console',
      libraryId: libraryOne,
      sessionId: consoleSessionOne,
      scriptSource: "return await serpent.tags.list();",
      declaredCapabilities: ['library.read', 'tag.read'],
    });
    journal.start(execution.executionId);
    journal.authorizeFromDesktop({
      executionId: execution.executionId,
      persistence: 'session',
    });
    const worker: AutomationWorkerClient = {
      request: async () => ({
        ok: true,
        type: 'tag.list',
        tags: [{ tagId: 'tag-y2k', name: 'y2k', assetCount: 2 }],
      }),
    };
    const gateway = createAutomationCommandGateway(worker, journal, {
      auditSink: journal,
      auditLogger: {
        error: () => undefined,
      },
    });

    await expect(gateway.execute({
      apiVersion: 1,
      executionId: execution.executionId,
      commandId: 'tag.list',
      input: {},
    })).resolves.toMatchObject({
      ok: true,
      result: { total: 1 },
    });
    expect(journal.get(execution.executionId)).toMatchObject({
      commandCount: 1,
      succeededCommandCount: 1,
      failedCommandCount: 0,
      lastCommandId: 'tag.list',
    });
  });
});
