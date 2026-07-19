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

  return {
    handleOpenExternal,
    handleRevealInFolder,
    handleCopyFilePath,
    handleOpenFolderInFileManager,
    handleCopyFolderPath,
  };
}
