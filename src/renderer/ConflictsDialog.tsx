import { Icon } from "./Icons";
import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";

export interface ConflictsDialogProps {
  conflicts: ImportConflictPlan;
  duplicateDecision: "skip" | "merge" | "create-copy";
  nameDecision: "keep-both" | "replace" | "skip";
  onDuplicateDecisionChange: (
    value: "skip" | "merge" | "create-copy",
  ) => void;
  onNameDecisionChange: (value: "keep-both" | "replace" | "skip") => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConflictsDialog({
  conflicts,
  duplicateDecision,
  nameDecision,
  onDuplicateDecisionChange,
  onNameDecisionChange,
  onCancel,
  onConfirm,
}: ConflictsDialogProps) {
  const t = useT();
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="conflict-dialog-title"
        aria-modal="true"
        className="conflict-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="conflict-dialog-title">{t("dialog.conflicts.title")}</h2>
          </div>
        </div>
        <div className="conflict-summary">
          <div>
            <strong>{conflicts.fileCount}</strong>
            <span>{t("dialog.conflicts.pendingFiles")}</span>
          </div>
          <div>
            <strong>{conflicts.suspectedDuplicateCount}</strong>
            <span>{t("dialog.conflicts.suspectedDuplicates")}</span>
          </div>
          <div>
            <strong>{conflicts.nameConflictCount}</strong>
            <span>{t("dialog.conflicts.nameConflicts")}</span>
          </div>
        </div>
        <label className="decision-field" htmlFor="conflict-duplicate-decision">
          <span>{t("dialog.conflicts.suspectedDuplicates")}</span>
          <select
            autoFocus
            id="conflict-duplicate-decision"
            value={duplicateDecision}
            onChange={(event) =>
              onDuplicateDecisionChange(
                event.target.value as typeof duplicateDecision,
              )
            }
          >
            <option value="skip">{t("dialog.conflicts.skip")}</option>
            <option value="merge">{t("dialog.conflicts.merge")}</option>
            <option value="create-copy">{t("dialog.conflicts.createCopy")}</option>
          </select>
        </label>
        <label className="decision-field" htmlFor="conflict-name-decision">
          <span>{t("dialog.conflicts.nameConflicts")}</span>
          <select
            id="conflict-name-decision"
            value={nameDecision}
            onChange={(event) =>
              onNameDecisionChange(event.target.value as typeof nameDecision)
            }
          >
            <option value="keep-both">{t("dialog.conflicts.keepBoth")}</option>
            <option value="replace">{t("dialog.conflicts.replace")}</option>
            <option value="skip">{t("dialog.conflicts.skip")}</option>
          </select>
        </label>
        {conflicts.examples.length > 0 && (
          <div className="conflict-examples">
            {conflicts.examples.map((item, index) => (
              <span key={`${item.displayName}-${index}`}>
                <Icon name="file" size={13} />
                <span className="conflict-example-name" title={item.displayName}>
                  {item.displayName}
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            onClick={onConfirm}
            type="button"
          >
            {t("dialog.conflicts.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
