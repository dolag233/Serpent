import { useCallback, type MutableRefObject } from "react";

import type { AssetSummary, CollectionSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import {
  resolveCollectionDrop,
  resolveFolderDrop,
  resolveTrashDrop,
  type DragAssetFact,
  type DragDropMode,
} from "./asset-drag-drop";
import { LibraryOperationError, toMessage } from "./error-utils";
import { useLocale, useT } from "./i18n";

export type UndoableFileOp =
  | {
      readonly kind: "move" | "copy";
      readonly operationId: string;
    }
  | {
      readonly kind: "trash";
      readonly assetIds: readonly string[];
    };

export type UseAssetDragDropHandlersParams = {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  assets: AssetSummary[];
  assetScope: string;
  setNotice: (message: string) => void;
  setError: (message: string | null) => void;
  setUiState: (state: "loading" | "importing" | "ready") => void;
  clearAssetSelection: () => void;
  trashManagedAssets: (assetIds: string[]) => Promise<void>;
  reloadCurrentContentRef: MutableRefObject<() => Promise<void>>;
  setCollections: (collections: CollectionSummary[]) => void;
  setLastUndoableOp: (op: UndoableFileOp | null) => void;
};

/**
 * Internal canvas DnD executors (Serpent-uye). Pure drop decisions stay in
 * `asset-drag-drop.ts`; this hook only resolves asset facts and runs commands.
 */
export function useAssetDragDropHandlers({
  api,
  library,
  assets,
  assetScope,
  setNotice,
  setError,
  setUiState,
  clearAssetSelection,
  trashManagedAssets,
  reloadCurrentContentRef,
  setCollections,
  setLastUndoableOp,
}: UseAssetDragDropHandlersParams) {
  const t = useT();
  const { locale } = useLocale();

  const dragAssetFacts = useCallback(
    (assetIds: string[]): DragAssetFact[] =>
      assetIds.map((assetId) => {
        const summary = assets.find((candidate) => candidate.assetId === assetId);
        return {
          assetId,
          // Unknown summaries (paged out) fail closed: treated as ineligible.
          locationKind: summary?.locationKind ?? "linked",
          availability: summary?.availability ?? "missing",
          deletedAt: summary?.deletedAt ?? null,
        };
      }),
    [assets],
  );

  const handleAssetsDroppedOnFolder = useCallback(
    (targetFolderId: string | null, assetIds: string[], mode: DragDropMode) => {
      if (!api || !library) return;
      const resolution = resolveFolderDrop({
        targetFolderId,
        // The root row (targetFolderId null) matches the "root" scope; the
        // "all" scope is not a folder and never blocks a drop.
        currentFolderId: assetScope === "root" ? null : assetScope,
        assets: dragAssetFacts(assetIds),
        mode,
      });
      if (resolution.kind === "reject") {
        if (resolution.reason === "same-folder") {
          setNotice(t("toast.alreadyInFolder"));
        } else {
          setNotice(t("toast.noMovableAssets"));
        }
        return;
      }
      void (async () => {
        setUiState("loading");
        try {
          if (resolution.kind === "copy") {
            const result = await api.copyAssets({
              libraryId: library.libraryId,
              assetIds: resolution.assetIds,
              targetFolderId,
              conflictStrategy: "keep-both",
            });
            if (!result.ok) throw new LibraryOperationError(result.error);
            if (result.value.operationId) {
              setLastUndoableOp({
                kind: "copy",
                operationId: result.value.operationId,
              });
            } else {
              setLastUndoableOp(null);
            }
            setNotice(
              t("toast.copiedCount", { count: result.value.copiedCount }) +
                (result.value.skippedCount
                  ? t("toast.conflictSkippedSuffix", {
                      count: result.value.skippedCount,
                    })
                  : "") +
                (resolution.skippedCount
                  ? t("toast.unavailableSkippedSuffix", {
                      count: resolution.skippedCount,
                    })
                  : "") +
                t("common.sentenceEnd"),
            );
          } else {
            const result = await api.moveAssets({
              libraryId: library.libraryId,
              assetIds: resolution.assetIds,
              targetFolderId,
              conflictStrategy: "keep-both",
            });
            if (!result.ok) throw new LibraryOperationError(result.error);
            if (result.value.operationId) {
              setLastUndoableOp({
                kind: "move",
                operationId: result.value.operationId,
              });
            } else {
              setLastUndoableOp(null);
            }
            setNotice(
              t("toast.movedCount", { count: result.value.movedCount }) +
                (result.value.skippedCount
                  ? t("toast.conflictSkippedSuffix", {
                      count: result.value.skippedCount,
                    })
                  : "") +
                (resolution.skippedCount
                  ? t("toast.unavailableSkippedSuffix", {
                      count: resolution.skippedCount,
                    })
                  : "") +
                t("common.sentenceEnd"),
            );
          }
          clearAssetSelection();
          await reloadCurrentContentRef.current();
        } catch (caught) {
          setError(
            toMessage(
              caught,
              resolution.kind === "copy"
                ? t("toast.copyFailed")
                : t("toast.moveFailed"),
              locale,
            ),
          );
        } finally {
          setUiState("ready");
        }
      })();
    },
    [
      api,
      library,
      assetScope,
      dragAssetFacts,
      setNotice,
      setError,
      setUiState,
      clearAssetSelection,
      reloadCurrentContentRef,
      setLastUndoableOp,
      locale,
      t,
    ],
  );

  const handleAssetsDroppedOnCollection = useCallback(
    (collectionId: string, assetIds: string[], mode: DragDropMode) => {
      if (!api || !library) return;
      const resolution = resolveCollectionDrop({
        assets: dragAssetFacts(assetIds),
        mode,
      });
      if (resolution.kind === "reject") {
        setNotice(t("toast.noCollectionDropAssets"));
        return;
      }
      void (async () => {
        try {
          const result = await api.addCollectionAssets({
            libraryId: library.libraryId,
            collectionId,
            assetIds: resolution.assetIds,
          });
          if (!result.ok) throw new LibraryOperationError(result.error);
          const collectionResult = await api.listCollections({
            libraryId: library.libraryId,
          });
          if (collectionResult.ok) setCollections(collectionResult.value);
          setNotice(
            t("toast.addedToCollectionCount", {
              count: resolution.assetIds.length,
            }) +
              (resolution.skippedCount
                ? t("toast.unavailableSkippedSuffix", {
                    count: resolution.skippedCount,
                  })
                : "") +
              t("common.sentenceEnd"),
          );
        } catch (caught) {
          setError(toMessage(caught, t("toast.addToCollectionFailed"), locale));
        }
      })();
    },
    [api, library, dragAssetFacts, setNotice, setError, setCollections, locale, t],
  );

  const handleAssetsDroppedOnTrash = useCallback(
    (assetIds: string[]) => {
      if (!api || !library) return;
      const { assetIds: eligible, skippedCount } = resolveTrashDrop(
        dragAssetFacts(assetIds),
      );
      if (eligible.length === 0) {
        setNotice(t("toast.noTrashableAssets"));
        return;
      }
      void (async () => {
        await trashManagedAssets(eligible);
        if (skippedCount > 0) {
          setNotice(
            t("toast.trashedWithSkipped", {
              count: eligible.length,
              skipped: skippedCount,
            }),
          );
        }
      })();
    },
    [api, library, dragAssetFacts, trashManagedAssets, setNotice, t],
  );

  return {
    handleAssetsDroppedOnFolder,
    handleAssetsDroppedOnCollection,
    handleAssetsDroppedOnTrash,
  };
}
