import { describe, expect, it } from 'vitest';

import {
  createDesktopAutomationFilePlanApprovalHandler,
  type DesktopAutomationFilePlanSummary,
} from '../../src/main/automation-file-plan-approval';
import type { WorkerCommand } from '../../src/shared/protocol/requests';
import type { WorkerResult } from '../../src/shared/protocol/responses';

class RecordingWorker {
  readonly commands: WorkerCommand[] = [];

  constructor(private readonly result: WorkerResult) {}

  async request(command: WorkerCommand): Promise<WorkerResult> {
    this.commands.push(command);
    return this.result;
  }
}

const plannedResult: WorkerResult = {
  ok: true,
  type: 'automation.file-operation-planned',
  libraryId: 'library-1',
  operation: 'rename-file',
  changeSequence: 17,
  targetCount: 1,
  executableCount: 1,
  blockedCount: 0,
  undoSupported: false,
  assetStates: [{ assetId: 'asset-1', stateToken: 'a'.repeat(64) }],
};

describe('Desktop automation file-plan approval', () => {
  it('builds a readonly Worker preflight and returns only opaque state proof after approval', async () => {
    const worker = new RecordingWorker(plannedResult);
    const summaries: unknown[] = [];
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async (summary) => {
        summaries.push(summary);
        return true;
      },
    });

    const proof = await handler.prepareAndApprove({
      commandId: 'asset.rename-file',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: { assetId: 'asset-1', newBaseName: 'renamed' },
    });

    expect(worker.commands).toEqual([{
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'rename-file',
      assetIds: ['asset-1'],
      newBaseName: 'renamed',
    }]);
    expect(summaries).toEqual([{
      operation: 'rename-file',
      targetCount: 1,
      executableCount: 1,
      blockedCount: 0,
      undoSupported: false,
    }]);
    expect(proof).toEqual({
      planHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      expectedChangeSequence: 17,
      assetStates: [{ assetId: 'asset-1', stateToken: 'a'.repeat(64) }],
    });
    expect(JSON.stringify(proof)).not.toContain('renamed');
  });

  it('does not return a proof when the desktop confirmation is cancelled', async () => {
    const worker = new RecordingWorker({ ...plannedResult, operation: 'trash', undoSupported: true });
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async () => false,
    });

    await expect(handler.prepareAndApprove({
      commandId: 'asset.trash',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: { assetIds: ['asset-1'] },
    })).resolves.toBeUndefined();
    expect(worker.commands).toEqual([{
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'trash',
      assetIds: ['asset-1'],
    }]);
  });

  it('maps content replacement to a single-asset replace-content plan', async () => {
    const worker = new RecordingWorker({
      ...plannedResult,
      operation: 'replace-content',
      undoSupported: false,
    });
    const summaries: DesktopAutomationFilePlanSummary[] = [];
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async (summary) => {
        summaries.push(summary);
        return true;
      },
    });

    await expect(handler.prepareAndApprove({
      commandId: 'asset.content.replace',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: {
        assetId: 'asset-1',
        dataBase64: 'AQID',
      },
    })).resolves.toMatchObject({
      expectedChangeSequence: 17,
      assetStates: [{ assetId: 'asset-1', stateToken: 'a'.repeat(64) }],
    });
    expect(worker.commands).toEqual([{
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'replace-content',
      assetIds: ['asset-1'],
    }]);
    expect(summaries).toEqual([{
      operation: 'replace-content',
      targetCount: 1,
      executableCount: 1,
      blockedCount: 0,
      undoSupported: false,
    }]);
  });

  it('maps a batch content replacement to one plan and one confirmation', async () => {
    const worker = new RecordingWorker({
      ...plannedResult,
      operation: 'replace-content',
      targetCount: 2,
      executableCount: 2,
      assetStates: [
        { assetId: 'asset-1', stateToken: 'a'.repeat(64) },
        { assetId: 'asset-2', stateToken: 'b'.repeat(64) },
      ],
    });
    const summaries: DesktopAutomationFilePlanSummary[] = [];
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async (summary) => {
        summaries.push(summary);
        return true;
      },
    });

    const proof = await handler.prepareAndApprove({
      commandId: 'asset.content.replace-batch',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: {
        items: [
          { assetId: 'asset-1', dataBase64: 'AQID', expectedRevisionId: 'revision-1' },
          { assetId: 'asset-2', stagingToken: 'staging-2', expectedRevisionId: 'revision-2' },
        ],
      },
    });

    expect(worker.commands).toEqual([{
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'replace-content',
      assetIds: ['asset-1', 'asset-2'],
    }]);
    expect(summaries).toEqual([{
      operation: 'replace-content',
      targetCount: 2,
      executableCount: 2,
      blockedCount: 0,
      undoSupported: false,
    }]);
    expect(proof?.assetStates).toHaveLength(2);
  });

  it('runs onWill hooks after the readonly plan and before confirmation', async () => {
    const worker = new RecordingWorker({ ...plannedResult, operation: 'trash', undoSupported: true });
    const order: string[] = [];
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      runWillHooks: async () => {
        order.push('hooks');
        return { warnings: ['[com.example] check tags'] };
      },
      confirm: async (summary) => {
        order.push('confirm');
        expect(summary.hookWarnings).toEqual(['[com.example] check tags']);
        return true;
      },
    });

    const proof = await handler.prepareAndApprove({
      commandId: 'asset.trash',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: { assetIds: ['asset-1'] },
    });

    expect(order).toEqual(['hooks', 'confirm']);
    expect(proof?.expectedChangeSequence).toBe(17);
  });

  it('propagates PluginHookBlockedError before confirmation', async () => {
    const { PluginHookBlockedError } = await import('../../src/plugins/plugin-hooks');
    const worker = new RecordingWorker({ ...plannedResult, operation: 'trash', undoSupported: true });
    let confirmed = false;
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      runWillHooks: async () => {
        throw new PluginHookBlockedError({
          pluginId: 'com.example',
          hookCode: 'DEMO_BLOCK',
          message: 'blocked',
        });
      },
      confirm: async () => {
        confirmed = true;
        return true;
      },
    });

    await expect(handler.prepareAndApprove({
      commandId: 'asset.trash',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: { assetIds: ['asset-1'] },
    })).rejects.toBeInstanceOf(PluginHookBlockedError);
    expect(confirmed).toBe(false);
  });

  it('preflights imports through the readonly Worker path and returns source-state proof', async () => {
    const worker = new RecordingWorker({
      ok: true,
      type: 'automation.file-import-planned',
      plan: {
        libraryId: 'library-1',
        changeSequence: 21,
        fileCount: 2,
        totalBytes: 2048,
        suspectedDuplicateCount: 1,
        libraryDuplicateCount: 1,
        nameConflictCount: 0,
        sourceStates: [{
          sourcePath: '/tmp/one.png',
          stateToken: 'a'.repeat(64),
        }, {
          sourcePath: '/tmp/two.png',
          stateToken: 'b'.repeat(64),
        }],
      },
    });
    const summaries: DesktopAutomationFilePlanSummary[] = [];
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async (summary) => {
        summaries.push(summary);
        return true;
      },
    });

    const proof = await handler.prepareAndApprove({
      commandId: 'file.import',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: {
        sourceKind: 'files',
        sourcePaths: ['/tmp/one.png', '/tmp/two.png'],
      },
    });

    expect(worker.commands).toEqual([{
      type: 'automation.file-import-plan',
      libraryId: 'library-1',
      sourceKind: 'files',
      sourcePaths: ['/tmp/one.png', '/tmp/two.png'],
    }]);
    expect(summaries).toEqual([{
      operation: 'import',
      targetCount: 2,
      executableCount: 1,
      blockedCount: 1,
      undoSupported: true,
    }]);
    expect(proof).toMatchObject({
      planHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      expectedChangeSequence: 21,
      assetStates: [],
      importPlan: {
        expectedChangeSequence: 21,
        sourceStates: [
          { sourcePath: '/tmp/one.png', stateToken: 'a'.repeat(64) },
          { sourcePath: '/tmp/two.png', stateToken: 'b'.repeat(64) },
        ],
      },
    });
  });

  it('plans a batch rename once for all asset ids', async () => {
    const worker = new RecordingWorker({
      ...plannedResult,
      operation: 'rename-files',
      targetCount: 2,
      executableCount: 2,
      assetStates: [
        { assetId: 'asset-1', stateToken: 'a'.repeat(64) },
        { assetId: 'asset-2', stateToken: 'b'.repeat(64) },
      ],
    });
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async () => true,
    });

    await handler.prepareAndApprove({
      commandId: 'asset.rename-files',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: {
        items: [
          { assetId: 'asset-1', newBaseName: 'first-concept' },
          { assetId: 'asset-2', newBaseName: 'second-concept' },
        ],
      },
    });
    expect(worker.commands).toEqual([{
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'rename-files',
      assetIds: ['asset-1', 'asset-2'],
    }]);
  });

  it('plans a move with target folder and conflict strategy', async () => {
    const worker = new RecordingWorker({
      ...plannedResult,
      operation: 'move',
      targetCount: 2,
      executableCount: 2,
      undoSupported: true,
      assetStates: [
        { assetId: 'asset-1', stateToken: 'a'.repeat(64) },
        { assetId: 'asset-2', stateToken: 'b'.repeat(64) },
      ],
    });
    const summaries: DesktopAutomationFilePlanSummary[] = [];
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async (summary) => {
        summaries.push(summary);
        return true;
      },
    });

    const proof = await handler.prepareAndApprove({
      commandId: 'asset.move',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: {
        assetIds: ['asset-1', 'asset-2'],
        targetFolderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        conflictStrategy: 'skip',
      },
    });
    expect(worker.commands).toEqual([{
      type: 'automation.file-operation-plan',
      libraryId: 'library-1',
      operation: 'move',
      assetIds: ['asset-1', 'asset-2'],
      targetFolderId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      conflictStrategy: 'skip',
    }]);
    expect(summaries).toEqual([{
      operation: 'move',
      targetCount: 2,
      executableCount: 2,
      blockedCount: 0,
      undoSupported: true,
    }]);
    expect(proof?.assetStates).toHaveLength(2);
  });

  it('rejects a preflight that does not cover every requested asset', async () => {
    const worker = new RecordingWorker({ ...plannedResult, operation: 'rename-files' });
    let confirmCalls = 0;
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async () => {
        confirmCalls++;
        return true;
      },
    });

    await expect(handler.prepareAndApprove({
      commandId: 'asset.rename-files',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: {
        items: [
          { assetId: 'asset-1', newBaseName: 'first' },
          { assetId: 'asset-2', newBaseName: 'second' },
        ],
      },
    })).rejects.toThrow('does not cover the requested assets');
    expect(confirmCalls).toBe(0);
  });

  it('rejects an unexpected preflight result before opening a confirmation', async () => {
    const worker = new RecordingWorker({ ok: false, error: {
      code: 'LIBRARY_NOT_OPEN',
      message: 'The selected library is not open.',
    } });
    let confirmCalls = 0;
    const handler = createDesktopAutomationFilePlanApprovalHandler({
      workerClient: worker,
      confirm: async () => {
        confirmCalls++;
        return true;
      },
    });

    await expect(handler.prepareAndApprove({
      commandId: 'asset.restore-if-original-vacant',
      executionId: 'execution-1',
      libraryId: 'library-1',
      commandInput: { assetIds: ['asset-1'] },
    })).rejects.toThrow('unexpected automation file-operation plan');
    expect(confirmCalls).toBe(0);
  });
});
