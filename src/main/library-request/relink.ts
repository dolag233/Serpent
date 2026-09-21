import type { RendererRequest } from "../../shared/protocol/requests";
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
