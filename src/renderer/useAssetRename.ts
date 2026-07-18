import { useCallback, useState } from "react";

import type { AssetSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { PUBLIC_ERROR_MESSAGES_ZH, toMessage } from "./error-utils";
import {
  catalogs,
  DEFAULT_LOCALE,
  lookupMessage,
  translateForLocale,
  useLocale,
  type AppLocale,
} from "./i18n";

/**
 * REQ-MENU-008: state machine for single-asset inline canvas rename.
 * Extracted from App.tsx (acceptance rule 8): App renders the inline caption
 * input and wires the context-menu / shortcut entry. The worker owns the real
 * rename (extension preserved, disk + DB kept in sync); this hook owns session
 * state, client-side name validation, typed error mapping, and the
 * refresh/reselect convention after a successful rename.
 */
export interface AssetRenameDialogState {
  assetId: string;
  /** Preserved extension including the leading dot ("" when the file has none). */
  extension: string;
  /** Current editable base name (extension excluded). */
  value: string;
  /** Inline typed failure shown inside the open dialog. */
  error: string | null;
  /** True while a rename request is in flight; blocks duplicate submits. */
  submitting: boolean;
}

export interface UseAssetRenameParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  visibleAssets: AssetSummary[];
  reloadCurrentContent: () => Promise<void>;
  setNotice: (message: string) => void;
  setSelectedAssetId: (assetId: string) => void;
  setSelectedAssetIds: (assetIds: string[]) => void;
}

export interface UseAssetRenameResult {
  assetRenameDialog: AssetRenameDialogState | null;
  openAssetRename: (assetId: string) => void;
  changeAssetRenameValue: (value: string) => void;
  cancelAssetRename: () => void;
  submitAssetRename: () => Promise<void>;
}

// These rules mirror the worker's normalizeAssetFileBaseName (library-rules.ts)
// and its combined base+extension byte check. Client-side validation is a UX
// fast-path only: the IPC boundary would otherwise flatten the same violations
// into INTERNAL_ERROR (the protocol schema rejects separators/control
// characters), and the worker stays the authority for everything that passes.
const PATH_SEPARATOR = /[\\/]/u;
const CONTROL_CHARACTER = /[\p{Cc}]/u;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"|?*]/u;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Returns the user-facing rejection reason for a base name the worker would
 * refuse, or null when the name is worth sending. The dialog trims before
 * calling, matching normalizeAssetFileBaseName.
 */
export function assetFileBaseNameError(
  baseName: string,
  extension: string,
  locale: AppLocale = DEFAULT_LOCALE,
): string | null {
  const invalidNameMessage = translateForLocale(
    locale,
    "error.code.INVALID_ASSET_FILE_NAME",
  );
  if (baseName.length === 0) return invalidNameMessage;
  if (PATH_SEPARATOR.test(baseName)) return invalidNameMessage;
  if (WINDOWS_FORBIDDEN_CHARACTER.test(baseName)) return invalidNameMessage;
  if (CONTROL_CHARACTER.test(baseName)) return invalidNameMessage;
  if (baseName === "." || baseName === "..") return invalidNameMessage;
  if (/[. ]$/u.test(baseName)) return invalidNameMessage;
  if (WINDOWS_DEVICE_NAME.test(baseName)) return invalidNameMessage;
  // The filesystem limit applies to the whole component, extension included.
  if (utf8ByteLength(`${baseName}${extension}`) > 255)
    return invalidNameMessage;
  return null;
}

/**
 * Splits a display file name into editable base name and preserved extension
 * the same way the worker does (path.posix.extname semantics: a leading-dot
 * name like ".gitkeep" has no extension, a trailing dot belongs to the
 * extension).
 */
export function splitAssetFileName(displayName: string): {
  baseName: string;
  extension: string;
} {
  const dotIndex = displayName.lastIndexOf(".");
  if (dotIndex <= 0) return { baseName: displayName, extension: "" };
  return {
    baseName: displayName.slice(0, dotIndex),
    extension: displayName.slice(dotIndex),
  };
}

export function useAssetRename({
  api,
  library,
  visibleAssets,
  reloadCurrentContent,
  setNotice,
  setSelectedAssetId,
  setSelectedAssetIds,
}: UseAssetRenameParams): UseAssetRenameResult {
  const { locale } = useLocale();
  const [assetRenameDialog, setAssetRenameDialog] =
    useState<AssetRenameDialogState | null>(null);

  const openAssetRename = useCallback(
    (assetId: string) => {
      const asset = visibleAssets.find(
        (candidate) => candidate.assetId === assetId,
      );
      if (!asset) return;
      const { baseName, extension } = splitAssetFileName(asset.displayName);
      setAssetRenameDialog({
        assetId,
        extension,
        value: baseName,
        error: null,
        submitting: false,
      });
    },
    [visibleAssets],
  );

  const changeAssetRenameValue = useCallback((value: string) => {
    setAssetRenameDialog((current) =>
      current ? { ...current, value, error: null } : current,
    );
  }, []);

  const cancelAssetRename = useCallback(() => {
    setAssetRenameDialog(null);
  }, []);

  const submitAssetRename = useCallback(async () => {
    if (!api || !library || !assetRenameDialog || assetRenameDialog.submitting)
      return;
    const newBaseName = assetRenameDialog.value.trim();
    if (!newBaseName) return;
    const { assetId, extension } = assetRenameDialog;
    // First-line validation: protocol-schema violations (separators, control
    // characters) never produce a typed error from the worker, so they must be
    // caught here to show the friendly invalid-name reason inline.
    const validationError = assetFileBaseNameError(
      newBaseName,
      extension,
      locale,
    );
    if (validationError) {
      setAssetRenameDialog((current) =>
        current ? { ...current, error: validationError } : current,
      );
      return;
    }
    setAssetRenameDialog((current) =>
      current ? { ...current, submitting: true, error: null } : current,
    );
    const failedFallback = translateForLocale(locale, "assetRename.failed");
    try {
      const result = await api.renameAssetFile({
        libraryId: library.libraryId,
        assetId,
        newBaseName,
      });
      if (!result.ok) {
        // Typed failures (invalid name, name conflict, asset no longer
        // renameable) surface inline so the user can fix the name and retry;
        // the dialog deliberately stays open.
        const codeMessage =
          lookupMessage(catalogs[locale], `error.code.${result.error.code}`) ??
          PUBLIC_ERROR_MESSAGES_ZH[result.error.code];
        const message =
          codeMessage ?? toMessage(result.error, failedFallback, locale);
        setAssetRenameDialog((current) =>
          current && current.assetId === assetId
            ? { ...current, submitting: false, error: message }
            : current,
        );
        return;
      }
      setAssetRenameDialog(null);
      setNotice(
        translateForLocale(locale, "assetRename.success", {
          name: result.value.displayName,
        }),
      );
      await reloadCurrentContent();
      // The rename keeps the asset id, so re-assert selection after refresh.
      setSelectedAssetIds([assetId]);
      setSelectedAssetId(assetId);
    } catch (caught) {
      setAssetRenameDialog((current) =>
        current && current.assetId === assetId
          ? {
              ...current,
              submitting: false,
              error: toMessage(caught, failedFallback, locale),
            }
          : current,
      );
    }
  }, [
    api,
    library,
    assetRenameDialog,
    locale,
    reloadCurrentContent,
    setNotice,
    setSelectedAssetId,
    setSelectedAssetIds,
  ]);

  return {
    assetRenameDialog,
    openAssetRename,
    changeAssetRenameValue,
    cancelAssetRename,
    submitAssetRename,
  };
}
