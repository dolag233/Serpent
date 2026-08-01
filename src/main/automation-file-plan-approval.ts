import { createHash } from 'node:crypto';

import type {
  AutomationFilePlanApprovalHandler,
  AutomationWorkerClient,
} from '../automation/command-gateway';
import {
  automationCommandInputSchemas,
  type AutomationCommandId,
  type AutomationFileOperationPlanProof,
} from '../automation/command-registry';
import type { WorkerCommand } from '../shared/protocol/requests';
import type { WorkerResult } from '../shared/protocol/responses';

type FileOperation = 'create' | 'import' | 'trash' | 'move' | 'rename-file' | 'rename-files' | 'restore-if-original-vacant';

export interface DesktopAutomationFilePlanSummary {
  operation: FileOperation;
  targetCount: number;
  executableCount: number;
  blockedCount: number;
  undoSupported: boolean;
}

export interface DesktopAutomationFilePlanApprovalOptions {
  workerClient: AutomationWorkerClient;
  confirm(summary: DesktopAutomationFilePlanSummary): Promise<boolean>;
}

function planCommandFor(
  commandId: AutomationCommandId,
  libraryId: string,
  commandInput: unknown,
): Extract<WorkerCommand, { type: 'automation.file-operation-plan' }> {
  switch (commandId) {
    case 'asset.trash': {
      const input = automationCommandInputSchemas['asset.trash'].parse(commandInput);
      return {
        type: 'automation.file-operation-plan',
        libraryId,
        operation: 'trash',
        assetIds: input.assetIds,
      };
    }
    case 'asset.move': {
      const input = automationCommandInputSchemas['asset.move'].parse(commandInput);
      return {
        type: 'automation.file-operation-plan',
        libraryId,
        operation: 'move',
        assetIds: input.assetIds,
        targetFolderId: input.targetFolderId,
        ...(input.conflictStrategy === undefined ? {} : { conflictStrategy: input.conflictStrategy }),
      };
    }
    case 'asset.rename-file': {
      const input = automationCommandInputSchemas['asset.rename-file'].parse(commandInput);
      return {
        type: 'automation.file-operation-plan',
        libraryId,
        operation: 'rename-file',
        assetIds: [input.assetId],
        newBaseName: input.newBaseName,
      };
    }
    case 'asset.rename-files': {
      const input = automationCommandInputSchemas['asset.rename-files'].parse(commandInput);
      return {
        type: 'automation.file-operation-plan',
        libraryId,
        operation: 'rename-files',
        assetIds: input.items.map((item) => item.assetId),
      };
    }
    case 'asset.restore-if-original-vacant': {
      const input = automationCommandInputSchemas['asset.restore-if-original-vacant'].parse(commandInput);
      return {
        type: 'automation.file-operation-plan',
        libraryId,
        operation: 'restore-if-original-vacant',
        assetIds: input.assetIds,
      };
    }
    default:
      throw new Error(`No file-operation plan is available for ${commandId}.`);
  }
}

function parsePlanResult(result: WorkerResult): Extract<WorkerResult, {
  ok: true;
  type: 'automation.file-operation-planned';
}> {
  if (!result.ok || result.type !== 'automation.file-operation-planned') {
    throw new Error('Worker returned an unexpected automation file-operation plan result.');
  }
  return result;
}

function assertPlanCoversCommand(
  command: Extract<WorkerCommand, { type: 'automation.file-operation-plan' }>,
  planned: Extract<WorkerResult, { ok: true; type: 'automation.file-operation-planned' }>,
): void {
  const requestedIds = [...command.assetIds].sort();
  const plannedIds = planned.assetStates.map((state) => state.assetId).sort();
  if (
    planned.operation !== command.operation
    || planned.targetCount !== requestedIds.length
    || planned.assetStates.length !== requestedIds.length
    || requestedIds.some((assetId, index) => assetId !== plannedIds[index])
  ) {
    throw new Error('Worker returned a file-operation plan that does not cover the requested assets.');
  }
}

/**
 * Creates the desktop-only approval boundary for filesystem writes.  The
 * returned proof is made from Worker-supplied opaque state tokens and a
 * change-sequence fence.  It is passed straight back to the Worker with the
 * write command; scripts see neither the tokens nor real file paths.
 */
export function createDesktopAutomationFilePlanApprovalHandler(
  options: DesktopAutomationFilePlanApprovalOptions,
): AutomationFilePlanApprovalHandler {
  return {
    async prepareAndApprove({ commandId, executionId, libraryId, commandInput }): Promise<AutomationFileOperationPlanProof | undefined> {
      if (commandId === 'library.create') {
        const input = automationCommandInputSchemas['library.create'].parse(commandInput);
        const approved = await options.confirm({
          operation: 'create',
          targetCount: 1,
          executableCount: 1,
          blockedCount: 0,
          undoSupported: false,
        });
        if (!approved) return undefined;
        return {
          planHash: createHash('sha256').update(JSON.stringify({
            executionId,
            commandId,
            displayName: input.displayName,
            selectedParentPath: input.selectedParentPath,
          }), 'utf8').digest('hex'),
          expectedChangeSequence: 0,
          assetStates: [],
        };
      }
      if (commandId === 'file.import') {
        if (libraryId === null) throw new Error('A library must be bound before planning this file operation.');
        const input = automationCommandInputSchemas['file.import'].parse(commandInput);
        const planned = await options.workerClient.request({
          type: 'automation.file-import-plan',
          libraryId,
          sourceKind: input.sourceKind,
          sourcePaths: input.sourcePaths,
          ...(input.targetFolderId === undefined ? {} : { targetFolderId: input.targetFolderId }),
          ...(input.imageSequenceFps === undefined ? {} : { imageSequenceFps: input.imageSequenceFps }),
          ...(input.expandImageSequences === undefined ? {} : { expandImageSequences: input.expandImageSequences }),
        }, { readonly: true });
        if (
          !planned.ok
          || planned.type !== 'automation.file-import-planned'
          || planned.plan.libraryId !== libraryId
        ) {
          throw new Error('Worker returned an unexpected automation import plan result.');
        }
        const parsedPlan = planned.plan;
        const blockedCount = parsedPlan.suspectedDuplicateCount + parsedPlan.nameConflictCount;
        const approved = await options.confirm({
          operation: 'import',
          targetCount: parsedPlan.fileCount,
          executableCount: parsedPlan.fileCount - blockedCount,
          blockedCount,
          undoSupported: true,
        });
        if (!approved) return undefined;
        const planHash = createHash('sha256').update(JSON.stringify({
          executionId,
          commandId,
          libraryId,
          commandInput: input,
          plan: parsedPlan,
        }), 'utf8').digest('hex');
        return {
          planHash,
          expectedChangeSequence: parsedPlan.changeSequence,
          assetStates: [],
          importPlan: {
            planHash,
            expectedChangeSequence: parsedPlan.changeSequence,
            sourceStates: parsedPlan.sourceStates,
          },
        };
      }
      if (libraryId === null) throw new Error('A library must be bound before planning this file operation.');
      const command = planCommandFor(commandId, libraryId, commandInput);
      const planned = parsePlanResult(await options.workerClient.request(command, { readonly: true }));
      if (planned.libraryId !== libraryId) {
        throw new Error('Worker returned a plan for another library.');
      }
      assertPlanCoversCommand(command, planned);
      const approved = await options.confirm({
        operation: planned.operation,
        targetCount: planned.targetCount,
        executableCount: planned.executableCount,
        blockedCount: planned.blockedCount,
        undoSupported: planned.undoSupported,
      });
      if (!approved) return undefined;

      const planHash = createHash('sha256').update(JSON.stringify({
        executionId,
        commandId,
        libraryId,
        commandInput,
        expectedChangeSequence: planned.changeSequence,
        assetStates: planned.assetStates,
      }), 'utf8').digest('hex');
      return {
        planHash,
        expectedChangeSequence: planned.changeSequence,
        assetStates: planned.assetStates,
      };
    },
  };
}
