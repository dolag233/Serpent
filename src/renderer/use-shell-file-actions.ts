import { useCallback } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { toMessage } from "./error-utils";
import { useLocale, useT } from "./i18n";

export type UseShellFileActionsParams = {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  setError: (message: string | null) => void;
  setNotice: (message: string) => void;
};

/**
 * Shell open/reveal/copy actions for assets and managed folders (Serpent-uye).
 * Locale/`t` live inside the hook so App.tsx callers stay free of exhaustive-deps churn.
 */
export function useShellFileActions({
  api,
  library,
  setError,
  setNotice,
}: UseShellFileActionsParams) {
  const t = useT();
  const { locale } = useLocale();

  const handleOpenExternal = useCallback(
    async (assetId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.openExternal({
          libraryId: library.libraryId,
          assetId,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.openExternalFailed"), locale));
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.openExternalError"), locale));
      }
    },
    [api, library, locale, setError, t],
  );

  const handleOpenWith = useCallback(
    async (assetId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.openWith({
          libraryId: library.libraryId,
          assetId,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.openWithFailed"), locale));
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.openWithError"), locale));
      }
    },
    [api, library, locale, setError, t],
  );

  const handleRevealInFolder = useCallback(
    async (assetId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.revealInFolder({
          libraryId: library.libraryId,
          assetId,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.revealAssetFailed"), locale));
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.revealAssetError"), locale));
      }
    },
    [api, library, locale, setError, t],
  );

  const handleCopyFilePath = useCallback(
    async (assetId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.copyFilePath({
          libraryId: library.libraryId,
          assetId,
        });
        if (!result.ok) {
          setError(
            toMessage(result.error, t("toast.copyPathUnavailable"), locale),
          );
          return;
        }
        setNotice(t("toast.copyPathDone"));
      } catch (caught) {
        setError(toMessage(caught, t("toast.copyPathFailed"), locale));
      }
    },
    [api, library, locale, setError, setNotice, t],
  );

  const handleCopyAssetFiles = useCallback(
    async (assetIds: string[]) => {
      if (!api || !library || assetIds.length === 0) return;
      try {
        const result = await api.copyAssetFiles({
          libraryId: library.libraryId,
          assetIds,
        });
        if (!result.ok) {
          setError(
            toMessage(result.error, t("toast.assetCopyFailed"), locale),
          );
          return;
        }
        setNotice(
          assetIds.length === 1
            ? t("toast.assetCopyDone")
            : t("toast.assetCopyDoneMany", { count: assetIds.length }),
        );
      } catch (caught) {
        setError(toMessage(caught, t("toast.assetCopyFailed"), locale));
      }
    },
    [api, library, locale, setError, setNotice, t],
  );

  const handleOpenFolderInFileManager = useCallback(
    async (folderId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.openFolderInFileManager({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.openFolderFailed"), locale));
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.openFolderError"), locale));
      }
    },
    [api, library, locale, setError, t],
  );

  const handleOpenFolderWith = useCallback(
    async (folderId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.openFolderWith({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.openWithFailed"), locale));
        }
      } catch (caught) {
        setError(toMessage(caught, t("toast.openWithError"), locale));
      }
    },
    [api, library, locale, setError, t],
  );

  const handleCopyFolderPath = useCallback(
    async (folderId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.copyFolderPath({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) {
          setError(
            toMessage(result.error, t("toast.copyFolderPathUnavailable"), locale),
          );
          return;
        }
        setNotice(t("toast.copyFolderPathDone"));
      } catch (caught) {
        setError(toMessage(caught, t("toast.copyFolderPathFailed"), locale));
      }
    },
    [api, library, locale, setError, setNotice, t],
  );

  const handleCopyFolder = useCallback(
    async (folderId: string) => {
      if (!api || !library) return;
      try {
        const result = await api.copyFolder({
          libraryId: library.libraryId,
          folderId,
        });
        if (!result.ok) {
          setError(toMessage(result.error, t("toast.folderCopyFailed"), locale));
          return;
        }
        setNotice(t("toast.folderCopyDone"));
      } catch (caught) {
        setError(toMessage(caught, t("toast.folderCopyFailed"), locale));
      }
    },
    [api, library, locale, setError, setNotice, t],
  );

  return {
    handleOpenExternal,
    handleOpenWith,
    handleRevealInFolder,
    handleCopyFilePath,
    handleCopyAssetFiles,
    handleOpenFolderInFileManager,
    handleOpenFolderWith,
    handleCopyFolderPath,
    handleCopyFolder,
  };
}
