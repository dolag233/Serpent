import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import type { RememberedDuplicateDecision } from "./import-conflict-preferences";
import { ImportConflictDialogShell } from "./ImportConflictDialogShell";

export interface ContentDuplicateDialogProps {
  conflicts: ImportConflictPlan;
  decision: RememberedDuplicateDecision;
  remember: boolean;
  onDecisionChange: (value: RememberedDuplicateDecision) => void;
  onRememberChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Library / content duplicates only (Serpent-glua / zp8q / 79c7). */
export function ContentDuplicateDialog({
  conflicts,
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
  const examples = conflicts.examples
    .filter(
      (item) =>
        item.kind === "suspected-duplicate" || item.kind === "library-duplicate",
    )
    .map((item) => item.displayName);
  const confirmLabel =
    decision === "create-copy"
      ? t("dialog.conflicts.confirmImportAnyway")
      : t("dialog.conflicts.confirmSkip");

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
      examples={examples}
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
