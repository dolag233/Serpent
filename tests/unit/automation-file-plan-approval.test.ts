import { describe, expect, it } from 'vitest';

import { createDesktopAutomationFilePlanApprovalHandler } from '../../src/main/automation-file-plan-approval';
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
