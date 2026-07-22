import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import type { RememberedNameConflictDecision } from "./import-conflict-preferences";

export interface NameConflictDialogProps {
  conflicts: ImportConflictPlan;
  decision: RememberedNameConflictDecision;
  remember: boolean;
  onDecisionChange: (value: RememberedNameConflictDecision) => void;
  onRememberChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Same-folder name conflicts only (Serpent-9iyi / zp8q). */
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
  const examples = conflicts.examples.filter(
    (item) => item.kind === "name-conflict",
  );
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="name-conflict-dialog-title"
        aria-modal="true"
        className="conflict-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="name-conflict-dialog-title">
              {t("dialog.nameConflict.title")}
            </h2>
          </div>
        </div>
        <div className="conflict-summary">
          <div>
            <strong>{conflicts.nameConflictCount}</strong>
            <span>{t("dialog.nameConflict.countLabel")}</span>
          </div>
        </div>
        <label className="decision-field" htmlFor="name-conflict-decision">
          <span>{t("dialog.nameConflict.actionLabel")}</span>
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
            <option value="keep-both">
              {t("dialog.conflicts.autoRename")}
            </option>
            <option value="replace">{t("dialog.conflicts.replace")}</option>
            <option value="skip">{t("dialog.conflicts.skip")}</option>
          </select>
        </label>
        <label className="ai-config-check-row" htmlFor="name-conflict-remember">
          <input
            checked={remember}
            id="name-conflict-remember"
            onChange={(event) => onRememberChange(event.target.checked)}
            type="checkbox"
          />
          <span>{t("dialog.nameConflict.remember")}</span>
        </label>
        {examples.length > 0 && (
          <div className="conflict-examples">
            {examples.map((item, index) => (
              <span key={`${item.displayName}-${index}`}>
                <span className="conflict-example-name" title={item.displayName}>
                  {item.displayName}
                </span>
              </span>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            {t("common.cancel")}
          </button>
          <button className="primary-button" onClick={onConfirm} type="button">
            {t("dialog.conflicts.apply")}
          </button>
        </div>
      </div>
    </div>
  );
}
