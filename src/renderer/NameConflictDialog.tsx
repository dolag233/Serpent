import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import type { RememberedNameConflictDecision } from "./import-conflict-preferences";
import { ImportConflictDialogShell } from "./ImportConflictDialogShell";

export interface NameConflictDialogProps {
  conflicts: ImportConflictPlan;
  decision: RememberedNameConflictDecision;
  remember: boolean;
  onDecisionChange: (value: RememberedNameConflictDecision) => void;
  onRememberChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Same-folder name conflicts only (Serpent-9iyi / zp8q / 79c7). */
export function NameConflictDialog({
  conflicts,
  decision,
  remember,
  onDecisionChange,
  onRememberChange,
  onCancel,
  onConfirm,
}: NameConflictDialogProps) {
  const t = useT();
  const examples = conflicts.examples
    .filter((item) => item.kind === "name-conflict")
    .map((item) => item.displayName);
  const confirmLabel =
    decision === "keep-both"
      ? t("dialog.conflicts.confirmRename")
      : decision === "replace"
        ? t("dialog.conflicts.confirmReplace")
        : t("dialog.conflicts.confirmSkip");

  return (
    <ImportConflictDialogShell
      confirmLabel={confirmLabel}
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
