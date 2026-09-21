import type { RendererRequest } from "../../shared/protocol/requests";
import type { RendererResult, WorkerResult } from "../../shared/protocol/responses";
import { createPublicError } from "../../shared/protocol/errors";

export type MediaShellResultRuntime = {
  logInfo: (scope: string, message: string, context?: Record<string, unknown>) => void;
  logError: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
  openPath: (absolutePath: string) => Promise<string>;
  showItemInFolder: (absolutePath: string) => void;
  writeClipboardText: (text: string) => void;
  writeClipboardFilePaths: (absolutePaths: readonly string[]) => boolean;
  openWith: (absolutePath: string) => Promise<"failed" | "cancelled" | "opened">;
};

/**
 * Worker-result post-processing for preview URLs and OS open/copy/reveal.
 * Undefined means the result should continue through handleLibraryRequest.
 */
export async function tryHandleMediaShellWorkerResult(
  request: RendererRequest,
  workerResult: WorkerResult,
  runtime: MediaShellResultRuntime,
): Promise<RendererResult | undefined> {
  if (!workerResult.ok) return undefined;

  if (
    request.type === "asset.preview.request" &&
    workerResult.type === "media.preview-artifact"
  ) {
    const url =
      workerResult.status === "ready"
        ? workerResult.playbackMode === "source" &&
          workerResult.sourceRevisionId
          ? `serpent://source/${request.libraryId}/${request.assetId}?revision=${encodeURIComponent(workerResult.sourceRevisionId)}`
          : workerResult.artifactId
            ? `serpent://${workerResult.playbackMode === "proxy" ? "proxy" : "preview"}/${request.libraryId}/${workerResult.artifactId}`
            : undefined
        : undefined;
    const posterUrl = workerResult.posterArtifactId
      ? `serpent://preview/${request.libraryId}/${workerResult.posterArtifactId}`
      : undefined;
    if (
      workerResult.status === "failed" ||
      workerResult.status === "missing"
    ) {
      runtime.logInfo("media.preview.unavailable", "Preview is not available.", {
        assetId: request.assetId,
        status: workerResult.status,
        errorCode: workerResult.errorCode,
      });
    }
    return {
      ok: true,
      type: "asset.preview.resolved",
      assetId: request.assetId,
      mediaType: workerResult.mediaType,
      status: workerResult.status,
      kind: workerResult.kind,
      ...(url ? { url } : {}),
      ...(posterUrl ? { posterUrl } : {}),
      ...(workerResult.errorCode
        ? { errorCode: workerResult.errorCode }
        : {}),
      ...(workerResult.playbackMode
        ? { playbackMode: workerResult.playbackMode }
        : {}),
      ...(workerResult.sourceMimeType
        ? { sourceMimeType: workerResult.sourceMimeType }
        : {}),
      ...(workerResult.sourceContainer
        ? { sourceContainer: workerResult.sourceContainer }
        : {}),
      ...(workerResult.sourceCodecs
        ? { sourceCodecs: workerResult.sourceCodecs }
        : {}),
      ...(workerResult.sourceRevisionId
        ? {
            playbackToken: `${request.assetId}:${workerResult.sourceRevisionId}`,
          }
        : {}),
      ...(workerResult.exrPlanes ? { exrPlanes: workerResult.exrPlanes } : {}),
      ...(workerResult.selectedExrPlane === undefined
        ? {}
        : { selectedExrPlane: workerResult.selectedExrPlane }),
      ...(workerResult.colorSpacePending === undefined
        ? {}
        : { colorSpacePending: workerResult.colorSpacePending }),
      ...(workerResult.colorSpace ? { colorSpace: workerResult.colorSpace } : {}),
    } satisfies RendererResult;
  }

  if (
    request.type === "asset.open-external.request" &&
    workerResult.type === "media.asset-path"
  ) {
    try {
      const openError = await runtime.openPath(workerResult.absolutePath);
      if (openError) {
        runtime.logError("main.open-external", new Error(openError));
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "asset.open-external.requested",
        assetId: request.assetId,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.open-external", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "asset.open-with.request" &&
    workerResult.type === "media.asset-path"
  ) {
    const outcome = await runtime.openWith(workerResult.absolutePath);
    if (outcome === "failed") {
      runtime.logError("main.open-with", new Error("open-with failed"));
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
    // cancelled → quiet ok (no toast); opened → quiet ok.
    return {
      ok: true,
      type: "asset.open-with.requested",
      assetId: request.assetId,
    } satisfies RendererResult;
  }

  if (
    request.type === "asset.reveal-in-folder.request" &&
    workerResult.type === "media.asset-path"
  ) {
    try {
      runtime.showItemInFolder(workerResult.absolutePath);
      return {
        ok: true,
        type: "asset.reveal-in-folder.requested",
        assetId: request.assetId,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.reveal-in-folder", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "asset.copy-file-path.request" &&
    workerResult.type === "media.asset-path"
  ) {
    try {
      runtime.writeClipboardText(workerResult.absolutePath);
      return {
        ok: true,
        type: "asset.copy-file-path.requested",
        assetId: request.assetId,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.copy-file-path", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "asset.copy-files.request" &&
    workerResult.type === "media.asset-paths"
  ) {
    try {
      const wrote = runtime.writeClipboardFilePaths(workerResult.absolutePaths);
      if (!wrote) {
        runtime.logError(
          "main.copy-asset-files",
          new Error("clipboard file copy produced no file list"),
        );
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "asset.copy-files.requested",
        assetIds: workerResult.assetIds,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.copy-asset-files", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "asset.resolve-dropped-paths.request" &&
    workerResult.type === "media.asset-ids-resolved"
  ) {
    return {
      ok: true,
      type: "asset.dropped-paths.resolved",
      assetIds: workerResult.assetIds,
    } satisfies RendererResult;
  }

  if (
    request.type === "folder.open-in-file-manager.request" &&
    workerResult.type === "folder.path"
  ) {
    try {
      const openError = await runtime.openPath(workerResult.absolutePath);
      if (openError) {
        runtime.logError(
          "main.open-folder-in-file-manager",
          new Error(openError),
        );
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "folder.open-in-file-manager.requested",
        folderId: request.folderId,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.open-folder-in-file-manager", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "folder.open-with.request" &&
    workerResult.type === "folder.path"
  ) {
    const outcome = await runtime.openWith(workerResult.absolutePath);
    if (outcome === "failed") {
      runtime.logError("main.folder-open-with", new Error("open-with failed"));
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
    return {
      ok: true,
      type: "folder.open-with.requested",
      folderId: request.folderId,
    } satisfies RendererResult;
  }

  if (
    request.type === "folder.copy-path.request" &&
    workerResult.type === "folder.path"
  ) {
    try {
      runtime.writeClipboardText(workerResult.absolutePath);
      return {
        ok: true,
        type: "folder.copy-path.requested",
        folderId: request.folderId,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.copy-folder-path", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "folder.copy.request" &&
    workerResult.type === "folder.path"
  ) {
    try {
      const wrote = runtime.writeClipboardFilePaths([workerResult.absolutePath]);
      if (!wrote) {
        runtime.logError(
          "main.copy-folder-files",
          new Error("clipboard file copy produced no file list"),
        );
        return {
          ok: false,
          error: createPublicError("INTERNAL_ERROR"),
        } satisfies RendererResult;
      }
      return {
        ok: true,
        type: "folder.copy.requested",
        folderId: request.folderId,
      } satisfies RendererResult;
    } catch (error) {
      runtime.logError("main.copy-folder-files", error);
      return {
        ok: false,
        error: createPublicError("INTERNAL_ERROR"),
      } satisfies RendererResult;
    }
  }

  if (
    request.type === "asset.retry-artifact.request" &&
    workerResult.type === "media.retry-artifact.queued"
  ) {
    return {
      ok: true,
      type: "asset.retry-artifact.started",
      assetId: workerResult.assetId,
      kind: request.kind,
    } satisfies RendererResult;
  }

  if (
    request.type === "asset.thumbnail.request" &&
    workerResult.type === "media.thumbnail.generated"
  ) {
    return {
      ok: true,
      type: "asset.thumbnail.generated",
      assetId: workerResult.assetId,
      artifactId: workerResult.artifactId,
    } satisfies RendererResult;
  }

  return undefined;
}
