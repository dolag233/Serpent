import type { NativeImage } from "electron";

import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type {
  ImageSequenceImportOffer,
  RendererResult,
  WorkerResult,
} from "../../shared/protocol/responses";
import { createPublicError, publicReasonFromError } from "../../shared/protocol/errors";
import {
  classifyDroppedSourcePaths,
  readClipboardImage,
  stageClipboardImage,
  type ClipboardImageReaderDeps,
} from "../desktop-ingestion";
import { resolveImageSequenceImportPaths } from "../image-sequence-import";
import type { LibraryCommandBuildOutcome } from "./command-outcome";

export type PendingImageSequenceOffer = {
  offer: ImageSequenceImportOffer;
  expiresAt: number;
  nextSequenceIndex: number;
};

export type IngestionCommandRuntime = {
  isUnpackagedE2e: () => boolean;
  e2eEnv: (name: string) => string | undefined;
  workerAvailable: () => boolean;
  requestWorker: (command: WorkerCommand) => Promise<WorkerResult>;
  logInfo: (scope: string, message: string, context?: Record<string, unknown>) => void;
  logError: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
  getPendingSequenceOffer: (offerId: string) => PendingImageSequenceOffer | undefined;
  deletePendingSequenceOffer: (offerId: string) => void;
  setPendingSequenceNextIndex: (offerId: string, nextSequenceIndex: number) => void;
  tempPath: () => string;
  now: () => Date;
  createImageFromBuffer: (buffer: Buffer) => NativeImage;
  readFileBuffer: (filePath: string) => Buffer;
  clipboardImageDeps: ClipboardImageReaderDeps;
  clipboardAvailableFormats: () => string[];
  readClipboardFilePaths: () => string[];
};

/**
 * Drop, sequence-confirm, clipboard, and folder-paste command construction.
 * Undefined means the request should fall through to commandFor.
 */
export async function tryBuildIngestionCommand(
  request: RendererRequest,
  runtime: IngestionCommandRuntime,
): Promise<LibraryCommandBuildOutcome | undefined> {
  switch (request.type) {
    case "asset.import-drop.request": {
      let sourceKind: "files" | "folder";
      try {
        sourceKind = classifyDroppedSourcePaths(request.sourcePaths);
      } catch (error) {
        runtime.logError("desktop-ingestion.drop-selection", error, {
          sourceCount: request.sourcePaths.length,
        });
        const isSelectionShapeError =
          error instanceof Error && error.message === "INVALID_DROP_SELECTION";
        return {
          kind: "result",
          result: {
            ok: false,
            error: isSelectionShapeError
              ? createPublicError("INVALID_DROP_SELECTION")
              : createPublicError(
                  "INVALID_IMPORT_SOURCE",
                  publicReasonFromError(error),
                ),
          } satisfies RendererResult,
        };
      }
      const e2eAutoExpand =
        runtime.isUnpackagedE2e() &&
        // Serpent-866c20：序列帧确认面板（含导入前预览）只能在确认流程里跑，
        // 需要一条 E2E 保持真实交互，而不是被 E2E 自动展开吞掉。
        runtime.e2eEnv("SERPENT_E2E_SEQUENCE_PROMPT") !== "1";
      const disableSequenceCreate =
        request.detectImageSequences === false ||
        request.autoDetectImageSequences === false;
      if (
        sourceKind === "files" &&
        request.imageSequenceDecision?.action === "import-sequence"
      ) {
        if (!runtime.workerAvailable()) throw new Error("Library Worker is unavailable.");
        const probeResult = await runtime.requestWorker({
          type: "asset.import.probe-sequences",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          targetCollectionId: request.targetCollectionId,
          sourcePaths: request.sourcePaths,
        });
        if (!probeResult.ok) {
          return {
            kind: "result",
            result: {
              ok: false,
              error: probeResult.error,
            } satisfies RendererResult,
          };
        }
        if (
          probeResult.type !== "asset.import.sequence-offer" ||
          probeResult.offer.sequences.length === 0
        ) {
          return {
            kind: "command",
            command: {
              type: "asset.import.prepare",
              libraryId: request.libraryId,
              targetFolderId: request.targetFolderId,
              sourceKind,
              sourcePaths: request.sourcePaths,
              expandImageSequences: false,
            },
          };
        }
        const sequenceIndex = request.imageSequenceDecision.sequenceIndex ?? 0;
        const sequence =
          probeResult.offer.sequences[sequenceIndex] ??
          probeResult.offer.sequences[0]!;
        const firstFrame =
          request.imageSequenceDecision.firstFrame ?? sequence.firstFrame;
        const lastFrame =
          request.imageSequenceDecision.lastFrame ?? sequence.lastFrame;
        const rangedPaths: string[] = [];
        const framePaths = sequence.framePaths ?? [];
        for (let index = 0; index < framePaths.length; index += 1) {
          const frameNumber = sequence.firstFrame + index;
          if (frameNumber < firstFrame || frameNumber > lastFrame) continue;
          rangedPaths.push(framePaths[index]!);
        }
        return {
          kind: "command",
          command: {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "files",
            sourcePaths:
              request.imageSequenceDecision.applyToRest
                ? request.sourcePaths
                : rangedPaths.length >= 3
                  ? rangedPaths
                  : framePaths,
            expandImageSequences: false,
            createImageSequence: true,
            imageSequenceFps:
              request.imageSequenceDecision.fps ??
              probeResult.offer.defaultFps,
          },
        };
      }
      return {
        kind: "command",
        command: {
          type: "asset.import.prepare",
          libraryId: request.libraryId,
          targetFolderId: request.targetFolderId,
          sourceKind,
          sourcePaths: request.sourcePaths,
          expandImageSequences: e2eAutoExpand && sourceKind === "files",
          ...(disableSequenceCreate ? { createImageSequence: false } : {}),
          imageSequenceFps: e2eAutoExpand ? 30 : undefined,
        },
      };
    }
    case "asset.import-sequence.confirm": {
      const pending = runtime.getPendingSequenceOffer(request.offerId);
      if (!pending || pending.expiresAt <= Date.now()) {
        runtime.deletePendingSequenceOffer(request.offerId);
        return {
          kind: "result",
          result: {
            ok: false,
            error: createPublicError("IMPORT_NOT_FOUND"),
          } satisfies RendererResult,
        };
      }
      if (pending.offer.libraryId !== request.libraryId) {
        return {
          kind: "result",
          result: {
            ok: false,
            error: createPublicError("IMPORT_NOT_FOUND"),
          } satisfies RendererResult,
        };
      }
      const stored = pending.offer;
      const sequenceIndex = request.sequenceIndex ?? pending.nextSequenceIndex;
      if (sequenceIndex !== pending.nextSequenceIndex) {
        return {
          kind: "result",
          result: {
            ok: false,
            error: createPublicError("IMPORT_NOT_FOUND"),
          } satisfies RendererResult,
        };
      }
      const sequence = stored.sequences[sequenceIndex];
      const decision = resolveImageSequenceImportPaths({
        action: request.action,
        applyToRest: request.applyToRest === true,
        firstFrame: request.firstFrame ?? sequence?.firstFrame ?? 0,
        lastFrame: request.lastFrame ?? sequence?.lastFrame ?? 0,
        offer: stored,
        sequenceIndex,
      });
      if (decision.sourcePaths.length === 0) {
        return {
          kind: "result",
          result: {
            ok: false,
            error: createPublicError("INVALID_SELECTION"),
          } satisfies RendererResult,
        };
      }
      if (decision.nextSequenceIndex === null) {
        runtime.deletePendingSequenceOffer(request.offerId);
      } else {
        runtime.setPendingSequenceNextIndex(request.offerId, decision.nextSequenceIndex);
      }
      return {
        kind: "command",
        command: {
          type: "asset.import.prepare",
          libraryId: request.libraryId,
          targetFolderId: stored.targetFolderId,
          sourceKind: "files",
          sourcePaths: decision.sourcePaths,
          expandImageSequences: false,
          createImageSequence: decision.createImageSequence,
          ...(decision.createImageSequence
            ? { imageSequenceFps: request.fps ?? stored.defaultFps }
            : {}),
        },
      };
    }
    case "asset.import-clipboard.request": {
      let image;
      try {
        const e2eClipboardImagePath = runtime.e2eEnv("SERPENT_E2E_CLIPBOARD_IMAGE_PATH");
        if (runtime.isUnpackagedE2e() && e2eClipboardImagePath) {
          image = runtime.createImageFromBuffer(
            runtime.readFileBuffer(e2eClipboardImagePath),
          );
        } else {
          // Windows clipboard images arrive in several layouts; walk them all
          // (Chromium bitmap, registered PNG, bare DIB, HTML references).
          const extracted = readClipboardImage(runtime.clipboardImageDeps);
          if (!extracted) {
            runtime.logInfo(
              "desktop-ingestion.clipboard-formats",
              "no importable image on the clipboard",
              { formats: runtime.clipboardAvailableFormats() },
            );
            throw new Error("CLIPBOARD_IMAGE_NOT_FOUND");
          }
          image = extracted.image;
        }
        const injectedNow = runtime.e2eEnv("SERPENT_E2E_CLIPBOARD_NOW");
        const staged = stageClipboardImage(
          image,
          runtime.tempPath(),
          runtime.isUnpackagedE2e() && injectedNow
            ? new Date(injectedNow)
            : runtime.now(),
        );
        return {
          kind: "command",
          command: {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.targetFolderId,
            sourceKind: "files",
            sourcePaths: [staged.filePath],
          },
          clipboardStageDirectory: staged.directoryPath,
        };
      } catch (error) {
        runtime.logError("desktop-ingestion.clipboard-stage", error);
        const code =
          error instanceof Error &&
          error.message === "CLIPBOARD_IMAGE_NOT_FOUND"
            ? "CLIPBOARD_IMAGE_NOT_FOUND"
            : "INVALID_IMPORT_SOURCE";
        return {
          kind: "result",
          result: {
            ok: false,
            error: createPublicError(
              code,
              code === "INVALID_IMPORT_SOURCE"
                ? publicReasonFromError(error)
                : undefined,
            ),
          } satisfies RendererResult,
        };
      }
    }
    case "folder.paste.request": {
      try {
        const injectedPathsRaw = runtime.e2eEnv("SERPENT_E2E_CLIPBOARD_FILE_PATHS");
        const injectedPaths =
          runtime.isUnpackagedE2e() && injectedPathsRaw
            ? injectedPathsRaw.split("\n").filter(Boolean)
            : null;
        const sourcePaths = injectedPaths ?? runtime.readClipboardFilePaths();
        if (sourcePaths.length === 0) {
          return {
            kind: "result",
            result: {
              ok: false,
              error: createPublicError("CLIPBOARD_FILES_NOT_FOUND"),
            } satisfies RendererResult,
          };
        }
        const sourceKind = classifyDroppedSourcePaths(sourcePaths);
        return {
          kind: "command",
          command: {
            type: "asset.import.prepare",
            libraryId: request.libraryId,
            targetFolderId: request.folderId ?? undefined,
            sourceKind,
            sourcePaths,
            // Paste must never auto-group into an image sequence. Users expect
            // ordinary import + name/content conflict dialogs (PASTE-001).
            expandImageSequences: false,
            createImageSequence: false,
          },
        };
      } catch (error) {
        runtime.logError("desktop-ingestion.clipboard-files", error);
        const isSelectionShapeError =
          error instanceof Error && error.message === "INVALID_DROP_SELECTION";
        return {
          kind: "result",
          result: {
            ok: false,
            error: isSelectionShapeError
              ? createPublicError("INVALID_DROP_SELECTION")
              : createPublicError(
                  "INVALID_IMPORT_SOURCE",
                  publicReasonFromError(error),
                ),
          } satisfies RendererResult,
        };
      }
    }
    default:
      return undefined;
  }
}

export type SequenceProbeRuntime = {
  isUnpackagedE2e: () => boolean;
  workerAvailable: () => boolean;
  requestWorker: (command: WorkerCommand) => Promise<WorkerResult>;
  rememberSequenceOffer: (offer: ImageSequenceImportOffer) => ImageSequenceImportOffer;
};

/**
 * Optional sequence-offer probe after a file import.prepare command.
 * Undefined means the command is unchanged.
 */
export async function maybeProbeImportSequences(
  request: RendererRequest,
  command: WorkerCommand,
  runtime: SequenceProbeRuntime,
): Promise<LibraryCommandBuildOutcome | undefined> {
  if (
    command.type !== "asset.import.prepare" ||
    command.sourceKind !== "files" ||
    command.expandImageSequences === true ||
    request.type === "asset.import-files.request" ||
    request.type === "asset.import-drop.request" ||
    request.type === "asset.import-sequence.confirm" ||
    // Clipboard paste into a folder must keep ordinary conflict flows
    // (name-conflict / content-duplicate). Sequence probing here wrongly
    // offered a sequence dialog when pasting a single copied image
    // (PASTE-001 / Serpent-el2g).
    request.type === "folder.paste.request" ||
    runtime.isUnpackagedE2e()
  ) {
    return undefined;
  }
  if (!runtime.workerAvailable()) throw new Error("Library Worker is unavailable.");
  const probeResult = await runtime.requestWorker({
    type: "asset.import.probe-sequences",
    libraryId: command.libraryId,
    targetFolderId: command.targetFolderId,
    sourcePaths: command.sourcePaths,
  });
  if (!probeResult.ok) {
    return {
      kind: "result",
      result: {
        ok: false,
        error: probeResult.error,
      } satisfies RendererResult,
    };
  }
  if (
    probeResult.type === "asset.import.sequence-offer" &&
    probeResult.offer.sequences.length > 0
  ) {
    return {
      kind: "result",
      result: {
        ok: true,
        type: "asset.import.sequence-offer",
        offer: runtime.rememberSequenceOffer(probeResult.offer),
      } satisfies RendererResult,
    };
  }
  // The explicit normal-file path must not run the legacy post-import
  // sequence detector. Folder imports and automation calls that opt into
  // expansion keep the existing behavior above.
  return {
    kind: "command",
    command: { ...command, createImageSequence: false },
  };
}
