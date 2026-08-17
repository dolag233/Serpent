import type { ReactNode } from "react";

import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import type { RememberedNameConflictDecision } from "./import-conflict-preferences";
import { ImportConflictDialogShell } from "./ImportConflictDialogShell";

export interface NameConflictDialogProps {
  conflicts: ImportConflictPlan;
  libraryId: string;
  decision: RememberedNameConflictDecision;
  remember: boolean;
  onDecisionChange: (value: RememberedNameConflictDecision) => void;
  onRememberChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Same-folder name conflicts only (Serpent-9iyi / zp8q / 79c7 / 793k). */
export function NameConflictDialog({
  conflicts,
  libraryId,
  decision,
  remember,
  onDecisionChange,
  onRememberChange,
  onCancel,
  onConfirm,
}: NameConflictDialogProps) {
  const t = useT();
  const nameConflicts = conflicts.examples.filter(
    (item) => item.kind === "name-conflict",
  );
  const examples = nameConflicts.map((item) => item.displayName);

  // Serpent-793k: show the colliding (already-existing) asset's name and
  // thumbnail, matching the content-duplicate dialog.
  const examplesContent: ReactNode =
    nameConflicts.length === 0 ? null : (
      <ul className="conflict-duplicate-list">
        {nameConflicts.map((item, index) => {
          const thumb =
            item.existingThumbnailArtifactId && libraryId
              ? `serpent://preview/${libraryId}/${item.existingThumbnailArtifactId}`
              : null;
          return (
            <li
              className="conflict-duplicate-row"
              key={`${item.displayName}-${item.existingAssetId ?? index}`}
            >
              {thumb ? (
                <img
                  alt=""
                  className="conflict-duplicate-thumb"
                  src={thumb}
                />
              ) : (
                <span className="conflict-duplicate-thumb is-empty" aria-hidden />
              )}
              <div className="conflict-duplicate-copy">
                <span className="conflict-duplicate-incoming">
                  {t("dialog.contentDuplicate.incoming", {
                    name: item.displayName,
                  })}
                </span>
                <span className="conflict-duplicate-existing">
                  {item.existingDisplayName
                    ? t("dialog.contentDuplicate.existing", {
                        name: item.existingDisplayName,
                      })
                    : t("dialog.contentDuplicate.existingUnknown")}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );

  const confirmLabel =
    decision === "keep-both"
      ? t("dialog.conflicts.confirmRename")
      : decision === "replace"
        ? t("dialog.conflicts.confirmReplace")
        : t("dialog.conflicts.confirmSkip");

  return (
    <ImportConflictDialogShell
      confirmLabel={confirmLabel}
      examplesContent={examplesContent}
      decision={
        <select
          autoFocus
          id="name-conflict-decision"
          value={decision}
          onChange={(event) =>
            onDecisionChange(
              event.target.value as RememberedNameConflictDecision,
            )
          }
        >
          <option value="keep-both">{t("dialog.conflicts.autoRename")}</option>
          <option value="replace">{t("dialog.conflicts.replace")}</option>
          <option value="skip">{t("dialog.conflicts.skip")}</option>
        </select>
      }
      decisionControlId="name-conflict-decision"
      decisionLabel={t("dialog.nameConflict.actionLabel")}
      examples={examples}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onRememberChange={onRememberChange}
      remember={remember}
      rememberId="name-conflict-remember"
      rememberLabel={t("dialog.nameConflict.remember")}
      summary={t("dialog.nameConflict.summary", {
        count: conflicts.nameConflictCount,
      })}
      title={t("dialog.nameConflict.title")}
      titleId="name-conflict-dialog-title"
    />
  );
}
