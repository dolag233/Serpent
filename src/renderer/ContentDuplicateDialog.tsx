import type { ReactNode } from "react";

import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import type { RememberedDuplicateDecision } from "./import-conflict-preferences";
import { ImportConflictDialogShell } from "./ImportConflictDialogShell";

export interface ContentDuplicateDialogProps {
  conflicts: ImportConflictPlan;
  libraryId: string;
  decision: RememberedDuplicateDecision;
  remember: boolean;
  onDecisionChange: (value: RememberedDuplicateDecision) => void;
  onRememberChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Library / content duplicates only (Serpent-glua / zp8q / 79c7 / thuy). */
export function ContentDuplicateDialog({
  conflicts,
  libraryId,
  decision,
  remember,
  onDecisionChange,
  onRememberChange,
  onCancel,
  onConfirm,
}: ContentDuplicateDialogProps) {
  const t = useT();
  const totalDuplicates =
    conflicts.suspectedDuplicateCount + conflicts.libraryDuplicateCount;
  const duplicateExamples = conflicts.examples.filter(
    (item) =>
      item.kind === "suspected-duplicate" || item.kind === "library-duplicate",
  );
  const confirmLabel =
    decision === "create-copy"
      ? t("dialog.conflicts.confirmImportAnyway")
      : t("dialog.conflicts.confirmSkip");

  const examplesContent: ReactNode =
    duplicateExamples.length === 0 ? null : (
      <ul className="conflict-duplicate-list">
        {duplicateExamples.map((item, index) => {
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

  return (
    <ImportConflictDialogShell
      confirmLabel={confirmLabel}
      decision={
        <select
          autoFocus
          id="content-duplicate-decision"
          value={decision}
          onChange={(event) =>
            onDecisionChange(
              event.target.value as RememberedDuplicateDecision,
            )
          }
        >
          <option value="skip">{t("dialog.conflicts.skip")}</option>
          <option value="create-copy">
            {t("dialog.conflicts.importAnyway")}
          </option>
        </select>
      }
      decisionControlId="content-duplicate-decision"
      decisionLabel={t("dialog.contentDuplicate.actionLabel")}
      examples={[]}
      examplesContent={examplesContent}
      onCancel={onCancel}
      onConfirm={onConfirm}
      onRememberChange={onRememberChange}
      remember={remember}
      rememberId="content-duplicate-remember"
      rememberLabel={t("dialog.contentDuplicate.remember")}
      summary={t("dialog.contentDuplicate.summary", {
        count: totalDuplicates,
      })}
      title={t("dialog.contentDuplicate.title")}
      titleId="content-duplicate-dialog-title"
    />
  );
}
