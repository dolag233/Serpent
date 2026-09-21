import type { RendererRequest } from "../../shared/protocol/requests";
import type { RendererResult } from "../../shared/protocol/responses";

export type PreviewOwnedRequestRuntime = {
  logError: (scope: string, error: unknown, context?: Record<string, unknown>) => void;
};

/**
 * Main-owned preview close and renderer error reports.
 * Undefined means the request is not handled here.
 */
export async function tryHandlePreviewOwnedRequest(
  request: RendererRequest,
  runtime: PreviewOwnedRequestRuntime,
): Promise<RendererResult | undefined> {
  switch (request.type) {
    case "asset.close-preview.request":
      return {
        ok: true,
        type: "asset.preview.closed",
        assetId: request.assetId,
      } satisfies RendererResult;
    case "asset.preview-error.report":
      runtime.logError(
        "media.preview.renderer",
        new Error(`Renderer media element reported ${request.errorCode}.`),
        {
          libraryId: request.libraryId,
          assetId: request.assetId,
          errorCode: request.errorCode,
          detail: request.detail,
        },
      );
      return {
        ok: true,
        type: "asset.preview-error.recorded",
        assetId: request.assetId,
      } satisfies RendererResult;
    default:
      return undefined;
  }
}
