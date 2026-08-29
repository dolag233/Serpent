import type { SerpentLibraryApi } from "../shared/library-api";

/**
 * Library requests that can mutate the catalog or its source files. Keeping
 * this list at the API boundary means a new renderer action cannot silently
 * bypass the library-switch safety warning just because it lives in a hook.
 */
const LIBRARY_WRITE_METHODS: ReadonlySet<keyof SerpentLibraryApi> = new Set([
  "rename",
  "undoOperationHistory",
  "redoOperationHistory",
  "createFolder",
  "renameFolder",
  "createLinkedFolderDirectory",
  "renameLinkedFolderDirectory",
  "pasteIntoFolder",
  "cloneFolder",
  "moveFolders",
  "trashFolder",
  "trashSelection",
  "deleteFolderFromDisk",
  "restoreTrashedManagedFolder",
  "removeLinkedFolder",
  "deleteLinkedFolderSubtree",
  "createImageSequence",
  "dissolveImageSequence",
  "dissolveImageSequences",
  "setImageSequenceFps",
  "importFiles",
  "importFolder",
  "importEagleLibrary",
  "importBillfishLibrary",
  "importDropped",
  "pasteClipboardImage",
  "confirmImageSequenceImport",
  "resolveImport",
  "abandonImport",
  "refreshAssets",
  "importFolderAsLinked",
  "relinkMissingFolder",
  "setLinkedFolderRules",
  "setGitignore",
  "setIgnore",
  "copyAssetsToLinkedFolder",
  "convertLinkedFolderToManaged",
  "createTag",
  "renameTag",
  "deleteTag",
  "deleteTags",
  "mergeTags",
  "assignTags",
  "removeTags",
  "createCollection",
  "updateCollection",
  "reorderCollections",
  "deleteCollection",
  "addCollectionAssets",
  "removeCollectionAssets",
  "reorderCollectionAssets",
  "setAssetColorSpaceOverride",
  "setAssetMetadata",
  "setAssetsRating",
  "backfillAssetMetadata",
  "createSmartCollection",
  "updateSmartCollection",
  "deleteSmartCollection",
  "trashAssets",
  "restoreAssets",
  "moveAssets",
  "undoMoveAssets",
  "copyAssets",
  "undoCopyAssets",
  "renameAssetFile",
  "saveTextAsset",
  "deleteAssetsPermanent",
  "deleteAssetsFromDisk",
  "purgeTrash",
  "deleteLinkedAssets",
  "relinkAsset",
  "relinkBatchPreview",
  "relinkBatchPreviewAtRoot",
  "relinkBatchApply",
  "cancelRelinkBatch",
  "exportLibrary",
  "cancelLibraryExport",
  "importLibrary",
  "importLibraryZip",
  "cancelLibraryImport",
  "importLibraryCopy",
  "importLibraryOpenInPlace",
  "setAiConfig",
  "analyzeAsset",
  "analyzeAssets",
  "syncSaveServer",
  "syncDeleteServer",
  "syncSaveBinding",
  "syncOpenRemoteLibrary",
  "syncRun",
  "convertModelFbx",
  "reportPreviewError",
  "copyAssetFiles",
  "openFolderWith",
  "retryArtifact",
  "pauseMediaJobs",
  "resumeMediaJobs",
  "cancelMediaJobs",
  "retryMediaJobs",
  "clearAiContent",
  "pauseAiJobs",
  "resumeAiJobs",
  "cancelAiJobs",
  "retryAiJobs",
]);

export function createTrackedLibraryApi(
  api: SerpentLibraryApi,
  onWriteStart: () => void,
  onWriteEnd: () => void,
  runWrite?: <T>(operation: () => Promise<T>) => Promise<T>,
): SerpentLibraryApi {
  // The preload bridge is frozen deliberately. A Proxy cannot return a
  // different function for a non-writable, non-configurable property, so use
  // a shallow mutable target while retaining the bridge's function values.
  const proxyTarget = { ...api } as SerpentLibraryApi;
  return new Proxy(proxyTarget, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== "string" ||
        !LIBRARY_WRITE_METHODS.has(property as keyof SerpentLibraryApi) ||
        typeof value !== "function"
      ) {
        return value;
      }

      return (...args: unknown[]) => {
        if (!runWrite) {
          onWriteStart();
          try {
            const result = Reflect.apply(value, target, args);
            return Promise.resolve(result).finally(onWriteEnd);
          } catch (error) {
            onWriteEnd();
            throw error;
          }
        }

        // Count queued writes too, so a transition requested while the FIFO
        // already contains a write still warns before waiting for it. If the
        // transition gate rejects this request before invocation, release the
        // count here; otherwise the invoked operation owns its release.
        onWriteStart();
        let invoked = false;
        return runWrite(async () => {
          invoked = true;
          try {
            return await Reflect.apply(value, target, args);
          } finally {
            onWriteEnd();
          }
        }).catch((error: unknown) => {
          if (!invoked) onWriteEnd();
          throw error;
        });
      };
    },
  });
}
