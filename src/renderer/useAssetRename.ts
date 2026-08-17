import { useCallback, useRef, useState } from "react";

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
 * REQ-MENU-008 / MENU-023: state machine for single-asset inline canvas rename.
 * Extracted from App.tsx (acceptance rule 8): App renders the inline caption
 * input and wires the context-menu / shortcut entry. The worker owns the real
 * rename (extension preserved, disk + DB kept in sync); this hook owns session
 * state, client-side name validation, typed error mapping, and the
 * refresh/reselect convention after a successful rename.
 *
 * Commit semantics match folder inline rename (Enter and blur share them):
 * - Blank value cancels (nothing meaningful to submit).
 * - Basename unchanged from session open cancels: no IPC, no success toast.
 * - Anything else submits; typed worker failures stay open with an inline error.
 */

export interface AssetRenameDialogState {
  assetId: string;
  /** Preserved extension including the leading dot ("" when the file has none). */
  extension: string;
  /** Basename when the session opened; re-committing it is a no-op cancel. */
  originalBaseName: string;
  /** Current editable base name (extension excluded). */
  value: string;
  /** Inline typed failure shown inside the open dialog. */
  error: string | null;
  /** True while a rename request is in flight; blocks duplicate submits. */
  submitting: boolean;
}

export type AssetRenameCommitResolution =
  | { action: "submit"; newBaseName: string }
  | { action: "cancel" }
  | { action: "keep-editing" };

export interface UseAssetRenameParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  visibleAssets: AssetSummary[];
  reloadCurrentContent: () => Promise<void>;
  setNotice: (message: string, historyEntryId?: string) => void;
  setSelectedAssetId: (assetId: string) => void;
  setSelectedAssetIds: (assetIds: string[]) => void;
}

export interface UseAssetRenameResult {
  assetRenameDialog: AssetRenameDialogState | null;
  openAssetRename: (assetId: string) => void;
  changeAssetRenameValue: (value: string) => void;
  cancelAssetRename: () => void;
  /** Enter and blur both route here; the resolver decides cancel vs submit. */
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

/**
 * Shared decision for Enter and blur. Unchanged basename cancels so the
 * client never shows a success toast for a no-op (worker would also no-op).
 */
export function resolveAssetRenameCommit(
  state: AssetRenameDialogState,
): AssetRenameCommitResolution {
  if (state.submitting) return { action: "keep-editing" };
  const newBaseName = state.value.trim();
  if (newBaseName.length === 0) return { action: "cancel" };
  if (newBaseName === state.originalBaseName) return { action: "cancel" };
  return { action: "submit", newBaseName };
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
  // Keep a synchronous mirror so Enter/Escape + the blur that follows
  // unmount/focus loss do not re-enter commit with a stale React closure.
  const assetRenameDialogRef = useRef<AssetRenameDialogState | null>(null);

  const replaceAssetRenameDialog = useCallback(
    (next: AssetRenameDialogState | null) => {
      assetRenameDialogRef.current = next;
      setAssetRenameDialog(next);
    },
    [],
  );

  const openAssetRename = useCallback(
    (assetId: string) => {
      const asset = visibleAssets.find(
        (candidate) => candidate.assetId === assetId,
      );
      if (!asset) return;
      const { baseName, extension } = splitAssetFileName(asset.displayName);
      replaceAssetRenameDialog({
        assetId,
        extension,
        originalBaseName: baseName,
        value: baseName,
        error: null,
        submitting: false,
      });
    },
    [replaceAssetRenameDialog, visibleAssets],
  );

  const changeAssetRenameValue = useCallback((value: string) => {
    const current = assetRenameDialogRef.current;
    if (!current) return;
    replaceAssetRenameDialog({ ...current, value, error: null });
  }, [replaceAssetRenameDialog]);

  const cancelAssetRename = useCallback(() => {
    replaceAssetRenameDialog(null);
  }, [replaceAssetRenameDialog]);

  const submitAssetRename = useCallback(async () => {
    const session = assetRenameDialogRef.current;
    if (!session) return;
    const resolution = resolveAssetRenameCommit(session);
    if (resolution.action === "keep-editing") return;
    if (resolution.action === "cancel") {
      replaceAssetRenameDialog(null);
      return;
    }
    if (!api || !library) return;
    const { assetId, extension } = session;
    const { newBaseName } = resolution;
    // First-line validation: protocol-schema violations (separators, control
    // characters) never produce a typed error from the worker, so they must be
    // caught here to show the friendly invalid-name reason inline.
    const validationError = assetFileBaseNameError(
      newBaseName,
      extension,
      locale,
    );
    if (validationError) {
      const current = assetRenameDialogRef.current;
      if (current && current.assetId === assetId) {
        replaceAssetRenameDialog({ ...current, error: validationError });
      }
      return;
    }
    const submittingSession = {
      ...session,
      submitting: true,
      error: null,
    };
    replaceAssetRenameDialog(submittingSession);
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
        const current = assetRenameDialogRef.current;
        if (current && current.assetId === assetId) {
          replaceAssetRenameDialog({
            ...current,
            submitting: false,
            error: message,
          });
        }
        return;
      }
      replaceAssetRenameDialog(null);
      setNotice(
        translateForLocale(locale, "assetRename.success", {
          name: result.value.displayName,
        }),
        result.value.historyEntryId,
      );
      await reloadCurrentContent();
      // The rename keeps the asset id, so re-assert selection after refresh.
      setSelectedAssetIds([assetId]);
      setSelectedAssetId(assetId);
    } catch (caught) {
      const current = assetRenameDialogRef.current;
      if (current && current.assetId === assetId) {
        replaceAssetRenameDialog({
          ...current,
          submitting: false,
          error: toMessage(caught, failedFallback, locale),
        });
      }
    }
  }, [
    api,
    library,
    locale,
    reloadCurrentContent,
    replaceAssetRenameDialog,
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
