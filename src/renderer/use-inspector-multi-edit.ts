/**
 * Multi-select Inspector metadata load / batch save / batch rating
 * (REQ-SELECT-004 / REQ-MENU-007; Serpent-uye extract from App.tsx).
 *
 * Owns `multiEdit` state and the selection-driven load effect. The shared
 * metadata cache + conflict set stay in App so single-asset save/load keep
 * using the same maps.
 */

import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { AssetMetadataResult, AssetSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { formatBatchRatingNotice } from "./batch-tag-notice";
import { LibraryOperationError, toMessage } from "./error-utils";
import { useLocale, useT } from "./i18n";
import {
  editorFieldsFromMultiEdit,
  rebuildMultiEditFromCache,
  type InspectorMultiEditModel,
} from "./inspector-multi-edit";

export type UseInspectorMultiEditParams = {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  selectedAssetIds: readonly string[];
  selectedAssetIdRef: MutableRefObject<string | undefined>;
  metadataByAssetRef: MutableRefObject<Map<string, AssetMetadataResult>>;
  metadataConflictAssetIdsRef: MutableRefObject<Set<string>>;
  setEditDescription: Dispatch<SetStateAction<string>>;
  setEditRating: Dispatch<SetStateAction<number>>;
  setEditFavorite: Dispatch<SetStateAction<boolean>>;
  setEditSourceUrl: Dispatch<SetStateAction<string>>;
  setEditAuthor: Dispatch<SetStateAction<string>>;
  setAssetMetadata: Dispatch<SetStateAction<AssetMetadataResult | null>>;
  setAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setTrashedAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setNotice: (message: string | null, historyEntryId?: string) => void;
  setError: (message: string | null) => void;
};

export type UseInspectorMultiEditResult = {
  multiEdit: InspectorMultiEditModel | null;
  applyMultiEditModel: (model: InspectorMultiEditModel | null) => void;
  rebuildAndApplyMultiEdit: (assetIds: readonly string[]) => void;
  saveMetadataForSelection: (
    assetIds: readonly string[],
    fields: {
      description?: string;
      favorite?: boolean;
      palette?: string[];
      sourcePageUrl?: string;
      author?: string;
    },
  ) => Promise<void>;
  batchSetRatingForSelection: (
    rating: number,
    assetIds: string[],
  ) => Promise<void>;
};

export function useInspectorMultiEdit({
  api,
  library,
  selectedAssetIds,
  selectedAssetIdRef,
  metadataByAssetRef,
  metadataConflictAssetIdsRef,
  setEditDescription,
  setEditRating,
  setEditFavorite,
  setEditSourceUrl,
  setEditAuthor,
  setAssetMetadata,
  setAssets,
  setTrashedAssets,
  setNotice,
  setError,
}: UseInspectorMultiEditParams): UseInspectorMultiEditResult {
  const t = useT();
  const { locale } = useLocale();
  const [multiEdit, setMultiEdit] = useState<InspectorMultiEditModel | null>(
    null,
  );

  const syncEditorsFromMultiEdit = useCallback(
    (model: InspectorMultiEditModel | null) => {
      if (!model) return;
      const fields = editorFieldsFromMultiEdit(model);
      setEditDescription(fields.description);
      setEditRating(fields.rating);
      setEditFavorite(fields.favorite);
      setEditSourceUrl(fields.sourceUrl);
      setEditAuthor(fields.author);
    },
    [
      setEditAuthor,
      setEditDescription,
      setEditFavorite,
      setEditRating,
      setEditSourceUrl,
    ],
  );

  const applyMultiEditModel = useCallback(
    (model: InspectorMultiEditModel | null) => {
      setMultiEdit(model);
      syncEditorsFromMultiEdit(model);
    },
    [syncEditorsFromMultiEdit],
  );

  const rebuildAndApplyMultiEdit = useCallback(
    (assetIds: readonly string[]) => {
      const model = rebuildMultiEditFromCache(
        assetIds,
        metadataByAssetRef.current,
      );
      applyMultiEditModel(model);
    },
    [applyMultiEditModel, metadataByAssetRef],
  );

  // REQ-SELECT-004: load metadata for every selected asset and derive mixed/uniform.
  useEffect(() => {
    const ids = [...selectedAssetIds];
    if (ids.length < 2 || !api || !library) {
      queueMicrotask(() => {
        setMultiEdit(null);
      });
      return;
    }
    let cancelled = false;
    const libraryId = library.libraryId;
    void (async () => {
      try {
        await Promise.all(
          ids.map(async (assetId) => {
            if (metadataByAssetRef.current.has(assetId)) return;
            const result = await api.getAssetMetadata({ libraryId, assetId });
            if (result.ok) {
              metadataByAssetRef.current.set(assetId, result.value);
            }
          }),
        );
        if (cancelled) return;
        const model = rebuildMultiEditFromCache(
          ids,
          metadataByAssetRef.current,
        );
        setMultiEdit(model);
        syncEditorsFromMultiEdit(model);
      } catch (caught) {
        if (!cancelled) {
          setError(toMessage(caught, t("toast.readMetadataFailed"), locale));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- join ids for stable dep
  }, [selectedAssetIds.join("\0"), library?.libraryId, api]);

  const saveMetadataForSelection = useCallback(
    async (
      assetIds: readonly string[],
      fields: {
        description?: string;
        favorite?: boolean;
        palette?: string[];
        sourcePageUrl?: string;
        author?: string;
      },
    ): Promise<void> => {
      if (!api || !library || assetIds.length === 0) return;
      const targetApi = api;
      const targetLibraryId = library.libraryId;
      let updated = 0;
      let conflicts = 0;
      let lastHistoryEntryId: string | undefined;
      for (const assetId of assetIds) {
        let current = metadataByAssetRef.current.get(assetId);
        if (!current) {
          const fetched = await targetApi.getAssetMetadata({
            libraryId: targetLibraryId,
            assetId,
          });
          if (!fetched.ok) continue;
          current = fetched.value;
          metadataByAssetRef.current.set(assetId, current);
        }
        if (metadataConflictAssetIdsRef.current.has(assetId)) {
          conflicts += 1;
          continue;
        }
        try {
          const result = await targetApi.setAssetMetadata({
            libraryId: targetLibraryId,
            assetId,
            expectedVersion: current.entityVersion,
            ...fields,
          });
          if (!result.ok) {
            if (result.error.code === "VERSION_CONFLICT") {
              metadataConflictAssetIdsRef.current.add(assetId);
              conflicts += 1;
              continue;
            }
            throw new LibraryOperationError(result.error);
          }
          metadataByAssetRef.current.set(assetId, result.value);
          updated += 1;
          lastHistoryEntryId = result.value.historyEntryId;
          if ("favorite" in fields && fields.favorite !== undefined) {
            const favorite = fields.favorite;
            const updateSummary = (asset: AssetSummary): AssetSummary =>
              asset.assetId === assetId ? { ...asset, favorite } : asset;
            setAssets((currentAssets) => currentAssets.map(updateSummary));
            setTrashedAssets((currentAssets) =>
              currentAssets.map(updateSummary),
            );
          }
          if (selectedAssetIdRef.current === assetId) {
            setAssetMetadata(result.value);
          }
        } catch (caught) {
          setError(toMessage(caught, t("toast.metadataSaveFailed"), locale));
          return;
        }
      }
      rebuildAndApplyMultiEdit([...assetIds]);
      if (conflicts > 0) {
        setNotice(t("toast.metadataVersionConflict"));
      } else if (updated > 0) {
        setNotice(t("toast.metadataSaved"), lastHistoryEntryId);
      }
    },
    [
      api,
      library,
      locale,
      metadataByAssetRef,
      metadataConflictAssetIdsRef,
      rebuildAndApplyMultiEdit,
      selectedAssetIdRef,
      setAssetMetadata,
      setAssets,
      setError,
      setNotice,
      setTrashedAssets,
      t,
    ],
  );

  const batchSetRatingForSelection = useCallback(
    async (rating: number, assetIds: string[]) => {
      if (!api || !library || assetIds.length === 0) return;
      try {
        const result = await api.setAssetsRating({
          libraryId: library.libraryId,
          assetIds,
          rating,
        });
        if (!result.ok) throw new LibraryOperationError(result.error);
        const skippedIds = new Set(
          result.value.skipped.map((item) => item.assetId),
        );
        const appliedIds = new Set(
          assetIds.filter((assetId) => !skippedIds.has(assetId)),
        );
        const updateSummary = (asset: AssetSummary): AssetSummary =>
          appliedIds.has(asset.assetId) ? { ...asset, rating } : asset;
        setAssets((current) => current.map(updateSummary));
        setTrashedAssets((current) => current.map(updateSummary));
        for (const assetId of appliedIds) {
          const cached = metadataByAssetRef.current.get(assetId);
          if (cached) {
            metadataByAssetRef.current.set(assetId, { ...cached, rating });
          }
        }
        const primaryAssetId = selectedAssetIdRef.current;
        if (primaryAssetId && appliedIds.has(primaryAssetId)) {
          setAssetMetadata((current) =>
            current && current.assetId === primaryAssetId
              ? { ...current, rating }
              : current,
          );
        }
        rebuildAndApplyMultiEdit(assetIds);
        setNotice(
          formatBatchRatingNotice(
            rating,
            assetIds.length - result.value.skipped.length,
            result.value.skipped,
            locale,
          ),
          result.value.historyEntryId,
        );
      } catch (caught) {
        setError(toMessage(caught, t("toast.batchRatingFailed"), locale));
      }
    },
    [
      api,
      library,
      locale,
      metadataByAssetRef,
      rebuildAndApplyMultiEdit,
      selectedAssetIdRef,
      setAssetMetadata,
      setAssets,
      setError,
      setNotice,
      setTrashedAssets,
      t,
    ],
  );

  return {
    multiEdit,
    applyMultiEditModel,
    rebuildAndApplyMultiEdit,
    saveMetadataForSelection,
    batchSetRatingForSelection,
  };
}
