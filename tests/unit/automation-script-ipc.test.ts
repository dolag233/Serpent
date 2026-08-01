import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createAutomationCommandGateway, type AutomationWorkerClient } from '../../src/automation/command-gateway';
import {
  AutomationExecutionJournal,
  createJsonFileAutomationExecutionStore,
} from '../../src/main/automation-execution-journal';
import { AutomationScriptFileService } from '../../src/main/automation-script-file-service';
import { createJsonFileAutomationRecentScriptsStore } from '../../src/main/automation-recent-scripts-store';
import { registerAutomationScriptIpc } from '../../src/main/automation-script-ipc';
import type { ScriptRuntimeExecutor } from '../../src/main/script-runtime-supervisor';
import {
  AUTOMATION_SCRIPT_COMMAND_CHANNEL,
  AUTOMATION_SCRIPT_COMPLETE_CHANNEL,
  AUTOMATION_SCRIPT_EXECUTE_CHANNEL,
  AUTOMATION_SCRIPT_SAVE_CHANNEL,
  AUTOMATION_SCRIPT_START_CHANNEL,
  AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL,
  AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL,
} from '../../src/shared/protocol/channels';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

const roots: string[] = [];
const libraryId = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

class FakeAutomationWorker implements AutomationWorkerClient {
  readonly commands: WorkerCommand[] = [];

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    if (command.type === 'library.list') {
      return {
        ok: true,
        type: 'library.list',
        libraries: [{ libraryId, displayName: 'Automation test', libraryPath: '/redacted' }],
      };
    }
    if (command.type === 'asset.rating.set') {
      return { ok: true, type: 'asset.rating.updated', updatedCount: 1, skipped: [] };
    }
    if (command.type === 'asset.search') {
      return {
        ok: true,
        type: 'asset.search.result',
        items: [],
        total: 0,
        offset: command.offset ?? 0,
      };
    }
    throw new Error(`Unexpected command ${command.type}`);
  }
}

describe('Desktop Console automation IPC', () => {
  it('runs the Main-authorized source in the isolated runtime and brokers its Gateway calls', async () => {
    const handlers = new Map<string, (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => Promise<unknown> | unknown>();
    const fakeIpcMain = { handle: (channel: string, handler: (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => unknown) => {
      handlers.set(channel, handler);
    } };
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-ipc-'));
    roots.push(root);
    const journal = new AutomationExecutionJournal({
      store: createJsonFileAutomationExecutionStore(path.join(root, 'execution.json')),
      logger: { info: () => undefined, error: () => undefined },
      newId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-${++value}`;
      })(),
    });
    const worker = new FakeAutomationWorker();
    const gateway = createAutomationCommandGateway(worker, journal, {
      auditSink: journal,
      auditLogger: { error: () => undefined },
    });
    const runtime: ScriptRuntimeExecutor = {
      run: async (input) => {
        expect(input.source).toBe("const matches = await serpent.assets.search({ query: 'Ser' });");
        const matches = await input.host.execute('asset.search', { query: 'Ser' });
        const updated = await input.host.execute('asset.rating.set', { assetIds: ['asset-1'], rating: 4 });
        return { ok: true, value: { matches, updated }, output: ['Updated 1 asset.'], transpiledJavaScript: '/* isolated */' };
      },
    };
    registerAutomationScriptIpc({
      ipcMain: fakeIpcMain as never,
      isAuthorizedSender: () => true,
      workerClient: () => worker as never,
      journal: () => journal,
      gateway: () => gateway,
      runtime: () => runtime,
      confirmDesktopWrite: async () => true,
      logger: () => undefined,
    });

    const event = { sender: { id: 6, once: () => undefined } };
    const start = await handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, {
      libraryId,
      source: "const matches = await serpent.assets.search({ query: 'Ser' });",
    });
    expect(start).toMatchObject({
      ok: true,
      executionId: 'execution-1',
      capabilities: expect.arrayContaining(['library.read', 'library.create', 'file.import']),
    });
    if (!start || typeof start !== 'object' || !('executionId' in start)) throw new Error('Expected an execution.');

    await expect(handlers.get(AUTOMATION_SCRIPT_EXECUTE_CHANNEL)!(event, {
      executionId: start.executionId,
    })).resolves.toMatchObject({
      ok: true,
      value: { updated: { updatedCount: 1, skipped: [] } },
      output: ['Updated 1 asset.'],
    });
    expect(worker.commands.slice(-2)).toEqual([
      expect.objectContaining({ type: 'asset.search', libraryId }),
      { type: 'asset.rating.set', libraryId, assetIds: ['asset-1'], rating: 4 },
    ]);
    expect(journal.get('execution-1')).toMatchObject({
      status: 'succeeded', commandCount: 2, succeededCommandCount: 2,
    });
  });

  it('creates a Main-owned execution, routes a rating write through Gateway, and records completion', async () => {
    const handlers = new Map<string, (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => Promise<unknown> | unknown>();
    const fakeIpcMain = { handle: (channel: string, handler: (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => unknown) => {
      handlers.set(channel, handler);
    } };
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-ipc-'));
    roots.push(root);
    const journal = new AutomationExecutionJournal({
      store: createJsonFileAutomationExecutionStore(path.join(root, 'execution.json')),
      logger: { info: () => undefined, error: () => undefined },
      newId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-${++value}`;
      })(),
    });
    const worker = new FakeAutomationWorker();
    const gateway = createAutomationCommandGateway(worker, journal, {
      auditSink: journal,
      auditLogger: { error: () => undefined },
    });
    registerAutomationScriptIpc({
      ipcMain: fakeIpcMain as never,
      isAuthorizedSender: () => true,
      workerClient: () => worker as never,
      journal: () => journal,
      gateway: () => gateway,
      runtime: () => ({ run: async () => ({ ok: true, value: undefined, output: [], transpiledJavaScript: '' }) }) satisfies ScriptRuntimeExecutor,
      confirmDesktopWrite: async () => true,
      logger: () => undefined,
    });

    const event = { sender: { id: 7, once: () => undefined } };
    const start = await handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, {
      libraryId,
      source: "const assets = await serpent.assets.search({ query: 'Ser' });",
    });
    expect(start).toMatchObject({ ok: true, executionId: 'execution-1' });

    const command = await handlers.get(AUTOMATION_SCRIPT_COMMAND_CHANNEL)!(event, {
      executionId: 'execution-1',
      commandId: 'asset.rating.set',
      input: { assetIds: ['asset-1'], rating: 4 },
    });
    expect(command).toEqual({ ok: true, result: { updatedCount: 1, skipped: [] } });
    expect(worker.commands.at(-1)).toEqual({
      type: 'asset.rating.set', libraryId, assetIds: ['asset-1'], rating: 4,
    });

    const search = await handlers.get(AUTOMATION_SCRIPT_COMMAND_CHANNEL)!(event, {
      executionId: 'execution-1',
      commandId: 'asset.search',
      input: { query: 'name:Ser tag:y2k | author:Jane', limit: 100, offset: 2 },
    });
    expect(search).toMatchObject({
      ok: true,
      result: { items: [], total: 0, limit: 100, offset: 2, hasMore: false },
    });
    expect(worker.commands.at(-1)).toEqual({
      type: 'asset.search',
      libraryId,
      query: {
        clauses: [],
        groups: [
          [
            { field: 'filename', values: ['Ser'], exclude: false },
            { field: 'tags', values: ['y2k'], exclude: false },
          ],
          [{ field: 'author', values: ['Jane'], exclude: false }],
        ],
      },
      scopeMode: false,
      limit: 100,
      offset: 2,
    });

    await handlers.get(AUTOMATION_SCRIPT_COMPLETE_CHANNEL)!(event, {
      executionId: 'execution-1', succeeded: true,
    });
    expect(journal.get('execution-1')).toMatchObject({
      status: 'succeeded', commandCount: 2, succeededCommandCount: 2,
    });
  });

  it('cancels owned executions when their renderer is destroyed', async () => {
    const handlers = new Map<string, (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => Promise<unknown> | unknown>();
    const fakeIpcMain = { handle: (channel: string, handler: (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => unknown) => {
      handlers.set(channel, handler);
    } };
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-ipc-'));
    roots.push(root);
    const journal = new AutomationExecutionJournal({
      store: createJsonFileAutomationExecutionStore(path.join(root, 'execution.json')),
      logger: { info: () => undefined, error: () => undefined },
      newId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-${++value}`;
      })(),
    });
    const worker = new FakeAutomationWorker();
    const gateway = createAutomationCommandGateway(worker, journal, {
      auditSink: journal,
      auditLogger: { error: () => undefined },
    });
    registerAutomationScriptIpc({
      ipcMain: fakeIpcMain as never,
      isAuthorizedSender: () => true,
      workerClient: () => worker as never,
      journal: () => journal,
      gateway: () => gateway,
      runtime: () => ({ run: async () => ({ ok: true, value: undefined, output: [], transpiledJavaScript: '' }) }) satisfies ScriptRuntimeExecutor,
      confirmDesktopWrite: async () => true,
      logger: () => undefined,
    });

    let destroyed: (() => void) | undefined;
    const event = { sender: { id: 8, once: (_name: 'destroyed', listener: () => void) => { destroyed = listener; } } };
    const start = await handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, {
      libraryId,
      source: "const assets = await serpent.assets.search({ query: 'Ser' });",
    });
    expect(start).toMatchObject({ ok: true, executionId: 'execution-1' });

    destroyed?.();

    expect(journal.get('execution-1')).toMatchObject({ status: 'cancelled' });
  });

  it('uses a Main-issued saved-script handle for persistent grants and rejects a forged source', async () => {
    const handlers = new Map<string, (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => Promise<unknown> | unknown>();
    const fakeIpcMain = { handle: (channel: string, handler: (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => unknown) => {
      handlers.set(channel, handler);
    } };
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-ipc-'));
    roots.push(root);
    const journal = new AutomationExecutionJournal({
      store: createJsonFileAutomationExecutionStore(path.join(root, 'execution.json')),
      logger: { info: () => undefined, error: () => undefined },
      newId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-${++value}`;
      })(),
    });
    const worker = new FakeAutomationWorker();
    const gateway = createAutomationCommandGateway(worker, journal, {
      auditSink: journal,
      auditLogger: { error: () => undefined },
    });
    const scriptFile = path.join(root, 'rating.serpent.ts');
    const scriptFiles = new AutomationScriptFileService({
      selectOpenScript: async () => undefined,
      selectSaveScript: async () => scriptFile,
      newScriptId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    let confirmations = 0;
    registerAutomationScriptIpc({
      ipcMain: fakeIpcMain as never,
      isAuthorizedSender: () => true,
      workerClient: () => worker as never,
      journal: () => journal,
      gateway: () => gateway,
      runtime: () => ({ run: async () => ({ ok: true, value: undefined, output: [], transpiledJavaScript: '' }) }) satisfies ScriptRuntimeExecutor,
      scriptFiles: () => scriptFiles,
      confirmDesktopWrite: async () => {
        confirmations += 1;
        return true;
      },
      logger: () => undefined,
    });

    const event = { sender: { id: 9, once: () => undefined } };
    const source = "return await serpent.assets.search({ query: 'Ser' });";
    const saved = await handlers.get(AUTOMATION_SCRIPT_SAVE_CHANNEL)!(event, { source });
    expect(saved).toMatchObject({ ok: true, scriptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', source });
    if (!saved || typeof saved !== 'object' || !('scriptId' in saved) || typeof saved.scriptId !== 'string') {
      throw new Error('Expected a saved script handle.');
    }

    const first = await handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, { libraryId, source, scriptId: saved.scriptId });
    expect(first).toMatchObject({ ok: true, executionId: 'execution-1' });
    expect(confirmations).toBe(1);
    const second = await handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, { libraryId, source, scriptId: saved.scriptId });
    expect(second).toMatchObject({ ok: true, executionId: 'execution-3' });
    expect(confirmations).toBe(1);
    await expect(handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, {
      libraryId,
      scriptId: saved.scriptId,
      source: `${source}\n// changed`,
    })).resolves.toMatchObject({ ok: false });
  });

  it('lists recent scripts without paths and opens them through Main-owned handles', async () => {
    const handlers = new Map<string, (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => Promise<unknown> | unknown>();
    const fakeIpcMain = { handle: (channel: string, handler: (event: { sender: { id: number; once: (event: 'destroyed', listener: () => void) => void } }, input: unknown) => unknown) => {
      handlers.set(channel, handler);
    } };
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-ipc-recent-'));
    roots.push(root);
    const scriptFile = path.join(root, 'recent.serpent.ts');
    const source = "return await serpent.assets.search({ query: 'Ser' });";
    const recentScripts = createJsonFileAutomationRecentScriptsStore(path.join(root, 'recent.json'), {
      newHandle: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    recentScripts.record('recent.serpent.ts', scriptFile);
    const scriptFiles = new AutomationScriptFileService({
      selectOpenScript: async () => undefined,
      selectSaveScript: async () => undefined,
      recentScripts,
      newScriptId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    registerAutomationScriptIpc({
      ipcMain: fakeIpcMain as never,
      isAuthorizedSender: () => true,
      workerClient: () => undefined,
      journal: () => undefined,
      gateway: () => undefined,
      runtime: () => undefined,
      scriptFiles: () => scriptFiles,
      confirmDesktopWrite: async () => true,
      logger: () => undefined,
    });

    const event = { sender: { id: 10, once: () => undefined } };
    const listed = handlers.get(AUTOMATION_SCRIPT_RECENT_LIST_CHANNEL)!(event, undefined);
    expect(listed).toEqual({
      ok: true,
      entries: [{
        handle: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        displayName: 'recent.serpent.ts',
        lastOpenedAt: expect.any(String),
      }],
    });
    expect(JSON.stringify(listed)).not.toContain(scriptFile);

    const opened = await handlers.get(AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL)!(event, {
      handle: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(opened).toMatchObject({ ok: false, code: 'io-failed' });

    const { writeFileSync } = await import('node:fs');
    writeFileSync(scriptFile, source);
    const reopened = await handlers.get(AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL)!(event, {
      handle: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(reopened).toMatchObject({
      ok: true,
      displayName: 'recent.serpent.ts',
      source,
    });
    expect(JSON.stringify(reopened)).not.toContain(scriptFile);

    await expect(handlers.get(AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL)!(event, {
      handle: 'not-a-uuid',
    })).resolves.toEqual({ ok: false, code: 'io-failed' });
    await expect(handlers.get(AUTOMATION_SCRIPT_RECENT_OPEN_CHANNEL)!(event, {
      handle: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })).resolves.toEqual({ ok: false, code: 'recent-script-not-found' });
  });
});
