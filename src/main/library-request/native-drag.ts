import type { RendererRequest } from "../../shared/protocol/requests";
import { nativeDragAssetsForResult } from "../native-asset-drag-prime";

/**
 * Serpent-v4jf/Serpent-29125f: how many sorted-list-head assets to prime
 * synchronously before a card-bearing response reaches the renderer. Native
 * drag can only use entries that are ready when dragstart enters Electron's
 * nested OS loop, but priming hundreds of cards here serializes every browse
 * response behind Worker work. The renderer's overscan window is normally a
 * few dozen cards, so keep this bounded to a small first-screen cushion.
 */
export const NATIVE_DRAG_PRIME_VISIBLE_COUNT = 64;

export type NativeDragPrimeRuntime = {
  pendingImportLibraries: Map<string, string>;
  primeImmediately: (
    libraryId: string,
    assetIds: string[],
    mode: "upsert",
  ) => void;
};

/**
 * Native file drag must be requested during renderer dragstart.
 * Preheat every card-bearing result before it reaches Renderer; a later
 * Worker round trip would miss Electron's native drag window. Upserting
 * instead of replacing avoids an auxiliary count query evicting the cards
 * visible in a concurrent search request.
 *
 * Serpent-v4jf: only the visible first screen (the sorted list head, i.e.
 * what the user actually sees and can drag immediately) is primed. The rest
 * of a large result is no longer primed at all — a card resolves on demand
 * when a drag actually starts.
 *
 * Serpent-8ee170: the browse result must reach the Renderer without waiting
 * for any drag-cache work. `media.get-asset-drag-infos` shares the
 * background-primary lane with reconciliation, so awaiting it here would
 * stall the response behind maintenance. Priming is fire-and-forget.
 *
 * Conflict resolution requests intentionally carry only importId; the
 * library context is retained from the earlier conflicts response until
 * the completion branch consumes it.
 */
export function maybePrimeNativeDrag(
  request: RendererRequest,
  workerResult: {
    readonly ok: boolean;
    readonly type?: string;
    readonly assets?: unknown;
    readonly items?: unknown;
    readonly asset?: unknown;
    readonly completion?: unknown;
    readonly result?: unknown;
  },
  runtime: NativeDragPrimeRuntime,
): void {
  const nativeDragAssets = nativeDragAssetsForResult(workerResult);
  const nativeDragLibraryId =
    "libraryId" in request && typeof request.libraryId === "string"
      ? request.libraryId
      : (request.type === "asset.import.resolve" ||
        request.type === "asset.import.skip-source-failure")
        ? runtime.pendingImportLibraries.get(request.importId)
        : undefined;
  if (nativeDragAssets.length === 0 || !nativeDragLibraryId) return;
  const dragAssetIds = nativeDragAssets.flatMap((asset) =>
    asset.sequence?.frames.map((frame) => frame.assetId) ?? [asset.assetId],
  );
  runtime.primeImmediately(
    nativeDragLibraryId,
    dragAssetIds.slice(0, NATIVE_DRAG_PRIME_VISIBLE_COUNT),
    "upsert",
  );
}
