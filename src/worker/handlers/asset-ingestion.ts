import {
  isImportCompletion,
  isImportConflictPlan,
  isImportSourceFailurePlan,
} from '../../shared/import-outcome';
import type { WorkerRequest } from '../../shared/protocol/requests';
import type {
  ImportCompletion,
  ImportConflictPlan,
  ImportSourceFailurePlan,
  WorkerResult,
} from '../../shared/protocol/responses';
import type { LibraryService } from '../library-service';

export type AssetIngestionHooks = {
  scheduleThumbnails: (
    libraryId: string,
    scene: 'mutation' | 'refresh' | 'linked',
    assetIds?: string[],
  ) => void;
  withMediaSchedulingSuspended: <T>(
    libraryId: string | undefined,
    operation: () => T | PromiseLike<T>,
    options?: { resumeScheduling?: boolean },
  ) => Promise<T>;
};

function encodeImportPrepareOutcome(
  prepared: ImportConflictPlan | ImportCompletion | ImportSourceFailurePlan,
): WorkerResult {
  if (isImportSourceFailurePlan(prepared)) {
    return { ok: true, type: 'asset.import.source-failure', plan: prepared };
  }
  if (isImportConflictPlan(prepared)) {
    return { ok: true, type: 'asset.import.conflicts', plan: prepared };
  }
  return { ok: true, type: 'asset.import.completed', completion: prepared };
}

export async function executeAssetIngestionWorkerCommand(
  libraryService: LibraryService,
  request: WorkerRequest,
  hooks: AssetIngestionHooks,
): Promise<WorkerResult | undefined> {
  switch (request.command.type) {
    case 'asset.list': {
      const assets = libraryService.listAssets(request.command);
      // Serpent-4bdd26 收编 codex/large-library-performance@d5f58088：渲染端
      // 布局完成后会上报真实视口。在这里先开一页规模的解码波会与该上报竞争，
      // 让首个可见窗口反而等待折叠线以下的任务；visible-window 处理器是
      // 浏览优先级的唯一来源。startup/import/mutation 场景仍为非渲染端调用方
      // 填充队列。
      return {
        ok: true,
        type: 'asset.list',
        assets,
      };
    }
    case 'asset.sequence.create': {
      const asset = libraryService.createImageSequence(request.command);
      hooks.scheduleThumbnails(
        request.command.libraryId,
        'mutation',
        asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
      );
      return { ok: true, type: 'asset.sequence.created', asset };
    }
    case 'asset.sequence.dissolve': {
      const sequenceId = libraryService.dissolveImageSequence(request.command);
      return { ok: true, type: 'asset.sequence.dissolved', sequenceId };
    }
    case 'asset.sequence.dissolve-batch': {
      const result = libraryService.dissolveImageSequences(request.command);
      return { ok: true, type: 'asset.sequence.dissolved-batch', ...result };
    }
    case 'asset.sequence.set-fps': {
      const result = libraryService.setImageSequenceFps(request.command);
      return { ok: true, type: 'asset.sequence.fps-updated', ...result };
    }
    case 'asset.import.probe-sequences': {
      const offer = await libraryService.probeImageSequenceImportOffer(request.command);
      return {
        ok: true,
        type: 'asset.import.sequence-offer',
        offer: offer ?? {
          defaultFps: 30,
          libraryId: request.command.libraryId,
          selectedPaths: request.command.sourcePaths,
          sequences: [],
          ...(request.command.targetFolderId
            ? { targetFolderId: request.command.targetFolderId }
            : {}),
          ...(request.command.targetCollectionId
            ? { targetCollectionId: request.command.targetCollectionId }
            : {}),
        },
      };
    }
    case 'asset.import.prepare': {
      const command = request.command;
      const prepared = await hooks.withMediaSchedulingSuspended(request.command.libraryId, () =>
        libraryService.prepareOrExecuteImportCancellable(command));
      if (isImportCompletion(prepared)) {
        hooks.scheduleThumbnails(
          request.command.libraryId,
          'mutation',
          prepared.assets.flatMap((asset) =>
            asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
          ),
        );
      }
      return encodeImportPrepareOutcome(prepared);
    }
    case 'asset.import-eagle': {
      const command = request.command;
      // Eagle entries bring their own still thumbnail. Do not enqueue a
      // whole-library video proxy wave here; visible-window/on-demand media
      // requests remain the only paths that may encode a source later.
      const result = await hooks.withMediaSchedulingSuspended(command.libraryId, () =>
        libraryService.importEagleLibrary(command));
      return { ok: true, type: 'asset.import-eagle.completed', result };
    }
    case 'asset.import-billfish': {
      const command = request.command;
      const result = await hooks.withMediaSchedulingSuspended(command.libraryId, () =>
        libraryService.importBillfishLibrary(command));
      return { ok: true, type: 'asset.import-billfish.completed', result };
    }
    case 'asset.import.resolve': {
      const command = request.command;
      const completion = await hooks.withMediaSchedulingSuspended(undefined, () =>
        libraryService.resolveImportCancellable(command));
      if (completion.assets.length > 0) {
        // The matching library already owns these opaque asset ids; schedule
        // through each open library without exposing paths to Main/Renderer.
        for (const library of libraryService.listLibraries()) {
          hooks.scheduleThumbnails(
            library.libraryId,
            'mutation',
            completion.assets.flatMap((asset) =>
              asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
            ),
          );
        }
      }
      return {
        ok: true,
        type: 'asset.import.completed',
        completion,
      };
    }
    case 'asset.import.skip-source-failure': {
      const command = request.command;
      const prepared = await hooks.withMediaSchedulingSuspended(undefined, () =>
        libraryService.continueAfterSourceFailureCancellable(command));
      if (isImportCompletion(prepared) && prepared.assets.length > 0) {
        for (const library of libraryService.listLibraries()) {
          hooks.scheduleThumbnails(
            library.libraryId,
            'mutation',
            prepared.assets.flatMap((asset) =>
              asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
            ),
          );
        }
      }
      return encodeImportPrepareOutcome(prepared);
    }
    case 'asset.import.abandon':
      return {
        ok: true,
        type: 'asset.import.abandoned',
        importId: libraryService.abandonImport(request.command.importId),
      };
    case 'asset.refresh': {
      const refresh = libraryService.refreshManagedAssets(request.command.libraryId, {
        includeAssets: true,
      });
      hooks.scheduleThumbnails(request.command.libraryId, 'refresh');
      return {
        ok: true,
        type: 'asset.refreshed',
        changedCount: refresh.changedCount,
        missingCount: refresh.missingCount,
        assets: refresh.assets ?? [],
      };
    }
    case 'asset.import-linked': {
      const command = request.command;
      const linkedFolder = await hooks.withMediaSchedulingSuspended(
        command.libraryId,
        () => libraryService.importFolderAsLinked({
          ...command,
          reconcileWatchers: false,
        }),
        { resumeScheduling: false },
      );
      // Linked import already registered every asset. Do not list the whole
      // folder just to seed a 50-id thumbnail scene — that would keep the
      // mutation on the Worker until tens of thousands of summaries load.
      // Also skip the unbounded post-import enqueue: it would insert jobs for
      // every missing thumbnail before browse can run.
      hooks.scheduleThumbnails(request.command.libraryId, 'linked');
      setImmediate(() => {
        try {
          if (!libraryService.hasOpenLibrary(command.libraryId)) return;
          libraryService.reconcileLinkedWatchersForLibrary(command.libraryId);
        } catch (error) {
          libraryService.reportDiagnostic('linked-watch.reconcile-deferred', error, {
            libraryId: command.libraryId,
          });
        }
      });
      return { ok: true, type: 'asset.import-linked.completed', linkedFolder };
    }
    default:
      return undefined;
  }
}
