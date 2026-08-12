import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  AutomationExecutionJournal,
  createJsonFileAutomationExecutionStore,
} from '../../src/main/automation-execution-journal';
import { registerAutomationScriptIpc } from '../../src/main/automation-script-ipc';
import {
  AUTOMATION_SCRIPT_COMPLETE_CHANNEL,
  AUTOMATION_SCRIPT_START_CHANNEL,
  AUTOMATION_SCRIPT_UNDO_CHANNEL,
} from '../../src/shared/protocol/channels';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

const libraryId = '11111111-1111-4111-8111-111111111111';
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('application automation undo entrypoint', () => {
  it('dispatches the latest completed undo group without exposing recovery details', async () => {
    const handlers = new Map<string, (event: { sender: { id: number; once: () => void } }, input?: unknown) => unknown>();
    const root = mkdtempSync(path.join(tmpdir(), 'serpent-automation-undo-'));
    roots.push(root);
    const journal = new AutomationExecutionJournal({
      store: createJsonFileAutomationExecutionStore(path.join(root, 'execution.json')),
      logger: { info: () => undefined, error: () => undefined },
      newId: (() => {
        let value = 0;
        return (prefix) => `${prefix}-${++value}`;
      })(),
    });
    const worker = {
      async request(command: WorkerCommand): Promise<WorkerResult> {
        if (command.type === 'library.list') {
          return { ok: true, type: 'library.list', libraries: [{ libraryId, displayName: 'Test', libraryPath: '/redacted' }] };
        }
        throw new Error(`Unexpected ${command.type}`);
      },
    };
    const recovered: unknown[] = [];
    registerAutomationScriptIpc({
      ipcMain: { handle: (channel: string, handler: (event: unknown, input?: unknown) => unknown) => handlers.set(channel, handler as never) } as never,
      isAuthorizedSender: () => true,
      workerClient: () => worker as never,
      journal: () => journal,
      gateway: () => ({ completeExecutionHistoryGroup: async () => true }) as never,
      runtime: () => ({}) as never,
      confirmDesktopWrite: async () => true,
      logger: () => undefined,
      undoGroup: () => ({
        recover: async (input) => {
          recovered.push(input);
          return { undoneCount: 1, skippedCount: 0 };
        },
      }),
    });

    const event = { sender: { id: 42, once: () => undefined } };
    const start = await handlers.get(AUTOMATION_SCRIPT_START_CHANNEL)!(event, {
      libraryId,
      source: 'return 1;',
    }) as { ok: true; executionId: string };
    expect(start.ok).toBe(true);
    const group = journal.createUndoGroup({ executionId: start.executionId, libraryId });
    journal.appendUndoGroupItems(group.undoGroupId, [{
      itemId: 'operation-1',
      kind: 'asset.move',
      reference: 'operation-1',
      reversible: true,
    }]);
    journal.completeUndoGroup(group.undoGroupId, { status: 'succeeded' });
    await handlers.get(AUTOMATION_SCRIPT_COMPLETE_CHANNEL)!(event, {
      executionId: start.executionId,
      succeeded: true,
    });

    await expect(handlers.get(AUTOMATION_SCRIPT_UNDO_CHANNEL)!(event, {
      executionId: start.executionId,
    })).resolves.toEqual({
      ok: true,
      undoGroupId: group.undoGroupId,
      undoneCount: 1,
      skippedCount: 0,
    });
    expect(recovered).toHaveLength(1);
    expect(journal.getUndoGroup(group.undoGroupId)?.undoable).toBe(false);
  });
});
