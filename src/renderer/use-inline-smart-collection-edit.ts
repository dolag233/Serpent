import { useCallback, useState } from "react";

import type { SerpentLibraryApi } from "../shared/library-api";
import type { RendererLibrarySummary } from "../shared/protocol/responses";
import { hasMeaningfulSmartCollectionCondition } from "../shared/smart-collection-query";
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

/**
 * SMART-007: React owner of the sidebar inline smart-collection create
 * session. Captures the current discovery definition at commit time (same as
 * the former top-bar save), validates a meaningful condition, then calls
 * smart-collection.create. Typed failures stay on the row.
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
  setNotice: (message: string) => void;
  reloadSmartCollections: () => Promise<void>;
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
    if (!hasMeaningfulSmartCollectionCondition(definition)) {
      setInlineSmartCollectionEdit((current) =>
        current && isSameInlineSmartCollectionEditSession(current, session)
          ? failInlineSmartCollectionEdit(
              current,
              t("toast.smartCollectionNeedsCondition"),
            )
          : current,
      );
      return;
    }

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
        queryDefinitionJson: JSON.stringify(definition),
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
      setNotice(t("toast.smartCollectionSaved"));
      await reloadSmartCollections();
    } catch (caught) {
      settleFailure(toMessage(caught, t("smartEdit.createFailed"), locale));
    }
  }, [
    api,
    getQueryDefinition,
    inlineSmartCollectionEdit,
    library,
    locale,
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
