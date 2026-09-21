import { parseRendererResult } from "../../shared/protocol/responses";
import type { RendererResult, WorkerResult } from "../../shared/protocol/responses";

/**
 * Strip Worker-only fields (libraryPath, recovery report path, relink token)
 * before the result crosses the Renderer boundary.
 */
export function toRendererResult(
  result: WorkerResult,
  relinkPreviewId?: string,
): RendererResult {
  if (!result.ok) return parseRendererResult(result);
  if (result.type === "library.opened") {
    return parseRendererResult({
      ok: true,
      type: result.type,
      library: {
        libraryId: result.library.libraryId,
        displayName: result.library.displayName,
        displayPath: result.library.libraryPath,
        // Serpent-033e: read-only degrade for newer-schema libraries.
        readOnly: result.library.readOnly,
        networkStorage: result.library.networkStorage,
        libraryVersion: result.library.libraryVersion,
        supportedSchemaVersion: result.library.supportedSchemaVersion,
        // Serpent-verg.5: read-only because the migration is stuck.
        migrationStuck: result.library.migrationStuck,
        // Keep the recovery report path inside Main/Worker. Renderer receives
        // only a boolean affordance so the filesystem boundary stays intact.
        recovery: result.library.recovery
          ? {
              mode: result.library.recovery.mode,
              ...(result.library.recovery.reportPath
                ? { reportAvailable: true }
                : {}),
              ...(result.library.recovery.recoveredAssetCount === undefined
                ? {}
                : { recoveredAssetCount: result.library.recovery.recoveredAssetCount }),
              ...(result.library.recovery.metadataRecovered === undefined
                ? {}
                : { metadataRecovered: result.library.recovery.metadataRecovered }),
              ...(result.library.recovery.metadataLosses === undefined
                ? {}
                : { metadataLosses: result.library.recovery.metadataLosses }),
            }
          : undefined,
      },
    });
  }
  if (result.type === "library.renamed") {
    return parseRendererResult({
      ok: true,
      type: result.type,
      library: {
        libraryId: result.library.libraryId,
        displayName: result.library.displayName,
        displayPath: result.library.libraryPath,
        networkStorage: result.library.networkStorage,
      },
    });
  }
  if (result.type === "asset.recovery-probe") {
    return parseRendererResult({
      ok: true,
      type: "asset.recovery-probe.result",
      assetId: result.assetId,
      probe: result.probe,
    });
  }
  if (result.type === "library.list") {
    return parseRendererResult({
      ok: true,
      type: result.type,
      libraries: result.libraries.map((library) => ({
        libraryId: library.libraryId,
        displayName: library.displayName,
        displayPath: library.libraryPath,
        networkStorage: library.networkStorage,
      })),
    });
  }
  // library.imported includes libraryPath but the renderer schema strips it.
  if (result.type === "library.imported") {
    // Use libraryPath for lifecycle but strip from renderer result.
    // The lifecycle is published in handleLibraryRequest above.
    return parseRendererResult({
      ok: true,
      type: "library.imported",
      importId: result.importId,
      libraryId: result.libraryId,
      displayName: result.displayName,
    });
  }
  // library.deleted includes libraryPath for Main recent-store cleanup only.
  if (result.type === "library.deleted") {
    return parseRendererResult({
      ok: true,
      type: "library.deleted",
      libraryId: result.libraryId,
      displayName: result.displayName,
      // Serpent-65d837: the library root is gone, but a `.del-*` aside may
      // still exist; the Renderer shows a deferred-cleanup notice.
      ...(result.pendingAsidePath ? { pendingCleanup: true } : {}),
    });
  }
  if (result.type === "asset.relink-batch.preview") {
    if (!relinkPreviewId) {
      throw new Error("Batch relink preview is missing its Main-process token.");
    }
    return parseRendererResult({
      ...result,
      previewId: relinkPreviewId,
    });
  }
  return parseRendererResult(result);
}
