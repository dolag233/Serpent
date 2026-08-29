import type { ReactNode } from "react";

import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export type LibraryLoadingOverlayProps = {
  readonly name: string | null;
  readonly onSwitchLibrary?: () => void;
};

/**
 * Covers the workspace while a library identity is being established.
 *
 * A library is a safety boundary: showing its folders or collections before
 * the navigation snapshot is ready makes a slow open look like data loss.
 * Keep this surface deliberately quiet so the safety signal is the operation
 * itself, not a second explanation competing with it.
 */
export function LibraryLoadingOverlay({
  name,
  onSwitchLibrary,
}: LibraryLoadingOverlayProps): ReactNode {
  const t = useT();
  const title = name?.trim()
    ? t("progress.openingLibraryNamed", { name: name.trim() })
    : t("progress.openingLibraryGeneric");

  return (
    <div
      className="dialog-backdrop library-loading-backdrop"
      data-library-loading-overlay="true"
      role="presentation"
    >
      <DialogShell
        className="library-loading-dialog"
        dialogId="library-loading-dialog"
        footer={
          onSwitchLibrary ? (
            <button
              className="secondary-button"
              onClick={onSwitchLibrary}
              type="button"
            >
              {t("progress.switchLibraryWhileLoading")}
            </button>
          ) : undefined
        }
        title={title}
      />
    </div>
  );
}
