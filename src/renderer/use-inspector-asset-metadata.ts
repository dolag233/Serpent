/**
 * Single-asset Inspector metadata load / versioned save + AI content hydrate
 * (Serpent-uye wave 6 extract from App.tsx).
 *
 * Multi-select editing stays in useInspectorMultiEdit; both share the App-owned
 * metadata cache / conflict set refs.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { AssetMetadataResult, AssetSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { LibraryOperationError, toMessage } from "./error-utils";
import { useLocale, useT } from "./i18n";
import { resolveInspectorDescription } from "./inspector-description";

export type InspectorAiContent = {
  assetId: string;
  description?: string;
  tags?: string[];
  rating?: number;
  modelVersion?: string;
};

export type UseInspectorAssetMetadataParams = {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  selectedAssetId: string | undefined;
  selectedAssetIdRef: MutableRefObject<string | undefined>;
  selectedAssetIdsRef: MutableRefObject<readonly string[]>;
  metadataByAssetRef: MutableRefObject<Map<string, AssetMetadataResult>>;
  metadataConflictAssetIdsRef: MutableRefObject<Set<string>>;
  assetMetadata: AssetMetadataResult | null;
  setAssetMetadata: Dispatch<SetStateAction<AssetMetadataResult | null>>;
  setVersionConflict: Dispatch<SetStateAction<boolean>>;
  setEditDescription: Dispatch<SetStateAction<string>>;
  setEditRating: Dispatch<SetStateAction<number>>;
  setEditFavorite: Dispatch<SetStateAction<boolean>>;
  setEditSourceUrl: Dispatch<SetStateAction<string>>;
  setEditAuthor: Dispatch<SetStateAction<string>>;
  setDescriptionIsAi: Dispatch<SetStateAction<boolean>>;
  aiContentRef: MutableRefObject<InspectorAiContent | null>;
  setAiContent: Dispatch<SetStateAction<InspectorAiContent | null>>;
  setAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setTrashedAssets: Dispatch<SetStateAction<AssetSummary[]>>;
  setNotice: (message: string | null, historyEntryId?: string) => void;
  setError: (message: string | null) => void;
};

export type MetadataSaveFields = {
  description?: string;
  rating?: number;
  favorite?: boolean;
  palette?: string[];
  sourcePageUrl?: string;
  author?: string;
};

export type UseInspectorAssetMetadataResult = {
  loadMetadata: () => Promise<void>;
  loadAiContentForAsset: (assetId: string) => Promise<void>;
  saveMetadata: (fields: MetadataSaveFields) => Promise<void>;
  applyLoadedMetadata: (
    targetAssetId: string,
    metadata: AssetMetadataResult,
  ) => void;
};

export function useInspectorAssetMetadata({
  api,
  library,
  selectedAssetId,
  selectedAssetIdRef,
  selectedAssetIdsRef,
  metadataByAssetRef,
  metadataConflictAssetIdsRef,
  assetMetadata,
  setAssetMetadata,
  setVersionConflict,
  setEditDescription,
  setEditRating,
  setEditFavorite,
  setEditSourceUrl,
  setEditAuthor,
  setDescriptionIsAi,
  aiContentRef,
  setAiContent,
  setAssets,
  setTrashedAssets,
  setNotice,
  setError,
}: UseInspectorAssetMetadataParams): UseInspectorAssetMetadataResult {
  const t = useT();
  const { locale } = useLocale();
  const metadataSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const applyLoadedMetadata = useCallback(
    (targetAssetId: string, metadata: AssetMetadataResult) => {
      metadataByAssetRef.current.set(targetAssetId, metadata);
      metadataConflictAssetIdsRef.current.delete(targetAssetId);
      if (selectedAssetIdRef.current !== targetAssetId) return;
      setAssetMetadata(metadata);
      // Multi-select edit fields are owned by the multi-edit effect (REQ-SELECT-004).
      if (selectedAssetIdsRef.current.length >= 2) return;
      const ai =
        aiContentRef.current?.assetId === targetAssetId
          ? aiContentRef.current
          : null;
      const description = resolveInspectorDescription(
        metadata.description,
        ai?.description,
      );
      setEditDescription(description.value);
      setDescriptionIsAi(description.fromAi);
      setEditRating(metadata.rating);
      setEditFavorite(metadata.favorite);
      setEditSourceUrl(metadata.sourcePageUrl ?? "");
      setEditAuthor(metadata.author ?? "");
    },
    [
      aiContentRef,
      metadataByAssetRef,
      metadataConflictAssetIdsRef,
      selectedAssetIdRef,
      selectedAssetIdsRef,
      setAssetMetadata,
      setDescriptionIsAi,
      setEditAuthor,
      setEditDescription,
      setEditFavorite,
      setEditRating,
      setEditSourceUrl,
    ],
  );

  const loadMetadata = useCallback(async () => {
    if (!api || !library || !selectedAssetId) return;
    const targetAssetId = selectedAssetId;
    setVersionConflict(false);
    try {
      const result = await api.getAssetMetadata({
        libraryId: library.libraryId,
        assetId: targetAssetId,
      });
      if (!result.ok) throw new LibraryOperationError(result.error);
      applyLoadedMetadata(targetAssetId, result.value);
    } catch (caught) {
      setError(toMessage(caught, t("toast.readMetadataFailed"), locale));
    }
  }, [
    api,
    applyLoadedMetadata,
    library,
    locale,
    selectedAssetId,
    setError,
    setVersionConflict,
    t,
  ]);

  const loadAiContentForAsset = useCallback(
    async (assetId: string) => {
      if (!api || !library || !assetId) {
        setAiContent(null);
        return;
      }
      try {
        const result = await api.getAiContent({
          libraryId: library.libraryId,
          assetId,
        });
        if (selectedAssetIdRef.current !== assetId) return;
        if (!result.ok) {
          setAiContent(null);
          return;
        }
        const { description, tags, rating, modelVersion } = result.value;
        const hasContent =
          Boolean(description?.trim()) ||
          tags.length > 0 ||
          rating != null;
        if (!hasContent) {
          setAiContent(null);
          if (selectedAssetIdsRef.current.length < 2) {
            const human =
              metadataByAssetRef.current.get(assetId)?.description ?? "";
            const resolved = resolveInspectorDescription(human, undefined);
            setEditDescription(resolved.value);
            setDescriptionIsAi(resolved.fromAi);
          }
          return;
        }
        const next: InspectorAiContent = {
          assetId,
          ...(description ? { description } : {}),
          ...(tags.length > 0 ? { tags } : {}),
          ...(rating != null ? { rating } : {}),
          ...(modelVersion ? { modelVersion } : {}),
        };
        setAiContent(next);
        if (selectedAssetIdsRef.current.length < 2) {
          const human =
            metadataByAssetRef.current.get(assetId)?.description ?? "";
          const resolved = resolveInspectorDescription(
            human,
            next.description,
          );
          setEditDescription(resolved.value);
          setDescriptionIsAi(resolved.fromAi);
        }
      } catch {
        if (selectedAssetIdRef.current === assetId) setAiContent(null);
      }
    },
    [
      api,
      library,
      metadataByAssetRef,
      selectedAssetIdRef,
      selectedAssetIdsRef,
      setAiContent,
      setDescriptionIsAi,
      setEditDescription,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    if (selectedAssetId) {
      void Promise.resolve().then(async () => {
        if (!api || !library) return;
        setVersionConflict(false);
        try {
          const result = await api.getAssetMetadata({
            libraryId: library.libraryId,
            assetId: selectedAssetId,
          });
          if (!cancelled && result.ok) {
            applyLoadedMetadata(selectedAssetId, result.value);
          } else if (!cancelled && !result.ok) {
            throw new LibraryOperationError(result.error);
          }
        } catch (caught) {
          if (!cancelled) {
            setError(toMessage(caught, t("toast.readMetadataFailed"), locale));
          }
        }
      });
      void Promise.resolve().then(async () => {
        if (cancelled) return;
        await loadAiContentForAsset(selectedAssetId);
      });
    } else {
      queueMicrotask(() => {
        setAssetMetadata(null);
        setVersionConflict(false);
        setAiContent(null);
        setDescriptionIsAi(false);
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selection primary only
  }, [selectedAssetId]);

  const saveMetadata = useCallback(
    (fields: MetadataSaveFields): Promise<void> => {
      if (!api || !library || !selectedAssetId || !assetMetadata) {
        return Promise.resolve();
      }
      const targetApi = api;
      const targetLibraryId = library.libraryId;
      const targetAssetId = selectedAssetId;
      if (metadataConflictAssetIdsRef.current.has(targetAssetId)) {
        return Promise.resolve();
      }
      if (!metadataByAssetRef.current.has(targetAssetId)) {
        metadataByAssetRef.current.set(targetAssetId, assetMetadata);
      }
      setVersionConflict(false);
      setError(null);

      const operation = metadataSaveQueueRef.current.then(async () => {
        if (metadataConflictAssetIdsRef.current.has(targetAssetId)) return;
        const currentMetadata = metadataByAssetRef.current.get(targetAssetId);
        if (!currentMetadata) return;
        try {
          const result = await targetApi.setAssetMetadata({
            libraryId: targetLibraryId,
            assetId: targetAssetId,
            expectedVersion: currentMetadata.entityVersion,
            ...fields,
          });
          if (!result.ok) {
            if (result.error.code === "VERSION_CONFLICT") {
              metadataConflictAssetIdsRef.current.add(targetAssetId);
              if (selectedAssetIdRef.current === targetAssetId) {
                setVersionConflict(true);
              }
              setNotice(t("toast.metadataVersionConflict"));
              return;
            }
            throw new LibraryOperationError(result.error);
          }

          metadataByAssetRef.current.set(targetAssetId, result.value);
          const updateSummary = (asset: AssetSummary): AssetSummary =>
            asset.assetId === targetAssetId
              ? {
                  ...asset,
                  rating: result.value.rating,
                  favorite: result.value.favorite,
                }
              : asset;
          setAssets((current) => current.map(updateSummary));
          setTrashedAssets((current) => current.map(updateSummary));
          if (selectedAssetIdRef.current === targetAssetId) {
            setAssetMetadata(result.value);
          }
          setNotice(t("toast.metadataSaved"), result.value.historyEntryId);
        } catch (caught) {
          setError(toMessage(caught, t("toast.metadataSaveFailed"), locale));
        }
      });
      metadataSaveQueueRef.current = operation;
      return operation;
    },
    [
      api,
      assetMetadata,
      library,
      locale,
      metadataByAssetRef,
      metadataConflictAssetIdsRef,
      selectedAssetId,
      selectedAssetIdRef,
      setAssetMetadata,
      setAssets,
      setError,
      setNotice,
      setTrashedAssets,
      setVersionConflict,
      t,
    ],
  );

  return {
    loadMetadata,
    loadAiContentForAsset,
    saveMetadata,
    applyLoadedMetadata,
  };
}
