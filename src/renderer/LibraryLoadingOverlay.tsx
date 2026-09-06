import type { ReactNode } from "react";

import { BlockingProgressOverlay } from "./BlockingProgressOverlay";
import { useT } from "./i18n";

export type LibraryLoadingOverlayProps = {
  readonly name: string | null;
  readonly operation?: "opening" | "deleting";
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
  operation = "opening",
  onSwitchLibrary,
}: LibraryLoadingOverlayProps): ReactNode {
  const t = useT();
  const title = name?.trim()
    ? t(
        operation === "deleting"
          ? "progress.deletingLibraryNamed"
          : "progress.openingLibraryNamed",
        { name: name.trim() },
      )
    : t(
        operation === "deleting"
          ? "progress.deletingLibraryGeneric"
          : "progress.openingLibraryGeneric",
      );

  return (
    <BlockingProgressOverlay
      cancelLabel={
        onSwitchLibrary ? t("progress.switchLibraryWhileLoading") : undefined
      }
      indeterminate
      kind="library-loading"
      onCancel={onSwitchLibrary}
      solidBackdrop
      title={title}
    />
  );
}
