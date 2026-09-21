import type { RendererRequest, WorkerCommand } from "../../shared/protocol/requests";

export function executeMediaPathMainCommand(
  request: RendererRequest,
): WorkerCommand | undefined {
  switch (request.type) {
    case "asset.thumbnail.request":
      return {
        type: "media.generate-thumbnail",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.thumbnail.visible-window.request":
      return {
        type: "asset.thumbnail.visible-window",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
        ...(request.consumerId === undefined ? {} : { consumerId: request.consumerId }),
        ...(request.libraryGeneration === undefined
          ? {}
          : { libraryGeneration: request.libraryGeneration }),
        ...(request.interactionGeneration === undefined
          ? {}
          : { interactionGeneration: request.interactionGeneration }),
        ...(request.viewportGeneration === undefined
          ? {}
          : { viewportGeneration: request.viewportGeneration }),
        ...(request.direction === undefined ? {} : { direction: request.direction }),
        ...(request.focusedAssetIds === undefined
          ? {}
          : { focusedAssetIds: request.focusedAssetIds }),
        ...(request.nearForwardAssetIds === undefined
          ? {}
          : { nearForwardAssetIds: request.nearForwardAssetIds }),
        ...(request.nearBackwardAssetIds === undefined
          ? {}
          : { nearBackwardAssetIds: request.nearBackwardAssetIds }),
        ...(request.scopeWarmAssetIds === undefined
          ? {}
          : { scopeWarmAssetIds: request.scopeWarmAssetIds }),
      };
    case "model.resolve-companions.request":
      // Slice C (Serpent-qvc6): 3D viewer companion-texture index. The worker
      // command already exists (slice A); this is the renderer request bridge.
      return {
        type: "model.resolve-companions",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "model.convert-fbx.request":
      // Slice C: FBX→GLB conversion (worker command from slice B). The
      // renderer routes `failed` results to the FBXLoader fallback.
      return {
        type: "model.convert-fbx",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.preview.request":
      // Handled directly in handleLibraryRequest because it requires constructing
      // a serpent:// URL after the Worker lookup.
      return {
        type: "media.get-preview-artifact",
        libraryId: request.libraryId,
        assetId: request.assetId,
        ...(request.intent === undefined ? {} : { intent: request.intent }),
        ...(request.exrPlane === undefined ? {} : { exrPlane: request.exrPlane }),
        ...(request.colorSpace === undefined ? {} : { colorSpace: request.colorSpace }),
      };
    case "asset.close-preview.request":
      // Preview close is a no-op on the Main side; renderer handles UI state.
      return undefined;
    case "asset.preview-error.report":
      // Main records this before command dispatch.
      return undefined;
    case "asset.recovery-probe.request":
      return {
        type: "asset.recovery-probe",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.open-external.request":
      // Handled directly in handleLibraryRequest because it requires shell.openPath.
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.open-with.request":
      // Handled directly in handleLibraryRequest (macOS picker / Windows Open With).
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.reveal-in-folder.request":
      // Handled directly in handleLibraryRequest because it requires shell.showItemInFolder.
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.copy-file-path.request":
      // Handled directly in handleLibraryRequest because it requires clipboard.writeText.
      return {
        type: "media.get-asset-path",
        libraryId: request.libraryId,
        assetId: request.assetId,
      };
    case "asset.copy-files.request":
      // OS file clipboard (clarification #5); paths resolved then written in Main.
      return {
        type: "media.get-asset-paths",
        libraryId: request.libraryId,
        assetIds: request.assetIds,
      };
    case "asset.retry-artifact.request":
      return {
        type: "media.retry-artifact",
        libraryId: request.libraryId,
        assetId: request.assetId,
        kind: request.kind,
      };
    default:
      return undefined;
  }
}
