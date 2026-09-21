import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";
import type { RendererResult } from "../../shared/protocol/responses";

export type RelinkOwnedRequestRuntime = {
  cancelRelinkPreview: (libraryId: string, previewId: string) => void;
};

/**
 * Main-owned relink-preview cancellation.
 * Undefined means the request is not handled here.
 */
export async function tryHandleRelinkOwnedRequest(
  request: RendererRequest,
  runtime: RelinkOwnedRequestRuntime,
): Promise<RendererResult | undefined> {
  switch (request.type) {
    case "asset.relink-batch.cancel.request":
      runtime.cancelRelinkPreview(request.libraryId, request.previewId);
      return {
        ok: true,
        type: "asset.relink-batch.cancelled",
        previewId: request.previewId,
      } satisfies RendererResult;
    default:
      return undefined;
  }
}

/**
 * Remember a relink batch preview before Worker dispatch.
 */
export function maybeRememberRelinkPreview(
  request: RendererRequest,
  command: WorkerCommand,
  createPreview: (libraryId: string, newRootPath: string) => string,
): { libraryId: string; previewId: string } | undefined {
  if (
    (request.type === "asset.relink-batch.request" ||
      request.type === "asset.relink-batch.preview-at-root.request") &&
    command.type === "asset.relink-batch.preview"
  ) {
    return {
      libraryId: request.libraryId,
      previewId: createPreview(request.libraryId, command.newRootPath),
    };
  }
  return undefined;
}
