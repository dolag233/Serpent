import { useCallback, useState } from "react";

import type { SmartCollectionSummary } from "../shared/asset-types";
import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { lookupMessage, useLocale, useT } from "./i18n";
import { catalogs } from "./i18n/catalogs";
import { PUBLIC_ERROR_MESSAGES_ZH, toMessage } from "./error-utils";
import {
  changeInlineSmartCollectionEditValue,
  failInlineSmartCollectionEdit,
  isSameInlineSmartCollectionEditSession,
  markInlineSmartCollectionEditSubmitting,
  resolveInlineSmartCollectionEditCommit,
  startInlineSmartCollectionCreate,
  type InlineSmartCollectionEditState,
} from "./inline-smart-collection-edit";

/** Empty draft query allowed at create time (Serpent-era). */
export const EMPTY_SMART_COLLECTION_QUERY_JSON = "{}";

/**
 * SMART-007 / Serpent-era: sidebar inline create. Create always succeeds with
 * a draft query (current discovery snapshot, or `{}` if empty). Caller opens
 * the settings dialog after success — do not block create for missing filters.
 */

export interface UseInlineSmartCollectionEditParams {
  api: SerpentLibraryApi | null;
  library: RendererLibrarySummary | null;
  /** Snapshot of discovery state when the name is committed. */
  getQueryDefinition: () => {
    search?: { clauses?: readonly unknown[] } | null;
    filters?: readonly unknown[] | null;
    sort?: unknown;
  };
  setNotice: (message: string, historyEntryId?: string) => void;
  reloadSmartCollections: () => Promise<void>;
  /** Fired after a successful create so the host can open settings. */
  onCreated?: (collection: SmartCollectionSummary) => void;
}

export interface UseInlineSmartCollectionEditResult {
  inlineSmartCollectionEdit: InlineSmartCollectionEditState | null;
  openInlineSmartCollectionCreate: () => void;
  changeInlineSmartCollectionEdit: (value: string) => void;
  cancelInlineSmartCollectionEdit: () => void;
  commitInlineSmartCollectionEdit: () => Promise<void>;
}

export function useInlineSmartCollectionEdit({
  api,
  library,
  getQueryDefinition,
  setNotice,
  reloadSmartCollections,
  onCreated,
}: UseInlineSmartCollectionEditParams): UseInlineSmartCollectionEditResult {
  const t = useT();
  const { locale } = useLocale();
  const [inlineSmartCollectionEdit, setInlineSmartCollectionEdit] =
    useState<InlineSmartCollectionEditState | null>(null);

  const openInlineSmartCollectionCreate = useCallback(() => {
    setInlineSmartCollectionEdit(
      startInlineSmartCollectionCreate(t("smartEdit.newName")),
    );
  }, [t]);

  const changeInlineSmartCollectionEdit = useCallback((value: string) => {
    setInlineSmartCollectionEdit((current) =>
      current ? changeInlineSmartCollectionEditValue(current, value) : current,
    );
  }, []);

  const cancelInlineSmartCollectionEdit = useCallback(() => {
    setInlineSmartCollectionEdit(null);
  }, []);

  const commitInlineSmartCollectionEdit = useCallback(async () => {
    const session = inlineSmartCollectionEdit;
    if (!session) return;
    const resolution = resolveInlineSmartCollectionEditCommit(session);
    if (resolution.action === "keep-editing") return;
    if (resolution.action === "cancel") {
      setInlineSmartCollectionEdit(null);
      return;
    }
    if (!api || !library) return;

    const definition = getQueryDefinition();
    const hasSearch = (definition.search?.clauses?.length ?? 0) > 0;
    const hasFilters = (definition.filters?.length ?? 0) > 0;
    const queryDefinitionJson =
      hasSearch || hasFilters
        ? JSON.stringify(definition)
        : EMPTY_SMART_COLLECTION_QUERY_JSON;

    setInlineSmartCollectionEdit((current) =>
      current && isSameInlineSmartCollectionEditSession(current, session)
        ? markInlineSmartCollectionEditSubmitting(current)
        : current,
    );

    const settleFailure = (message: string) => {
      setInlineSmartCollectionEdit((current) =>
        current && isSameInlineSmartCollectionEditSession(current, session)
          ? failInlineSmartCollectionEdit(current, message)
          : current,
      );
    };

    try {
      const result = await api.createSmartCollection({
        libraryId: library.libraryId,
        name: resolution.name,
        queryDefinitionJson,
      });
      if (!result.ok) {
        const codeMessage =
          lookupMessage(catalogs[locale], `error.code.${result.error.code}`) ??
          PUBLIC_ERROR_MESSAGES_ZH[result.error.code];
        settleFailure(
          codeMessage ??
            toMessage(result.error, t("smartEdit.createFailed"), locale),
        );
        return;
      }
      setInlineSmartCollectionEdit((current) =>
        current && isSameInlineSmartCollectionEditSession(current, session)
          ? null
          : current,
      );
      setNotice(t("toast.smartCollectionSaved"), result.value.historyEntryId);
      await reloadSmartCollections();
      onCreated?.(result.value);
    } catch (caught) {
      settleFailure(toMessage(caught, t("smartEdit.createFailed"), locale));
    }
  }, [
    api,
    getQueryDefinition,
    inlineSmartCollectionEdit,
    library,
    locale,
    onCreated,
    reloadSmartCollections,
    setNotice,
    t,
  ]);

  return {
    inlineSmartCollectionEdit,
    openInlineSmartCollectionCreate,
    changeInlineSmartCollectionEdit,
    cancelInlineSmartCollectionEdit,
    commitInlineSmartCollectionEdit,
  };
}
