import { useT } from "./i18n";
import type { ImportConflictPlan } from "../shared/protocol/responses";
import type { RememberedDuplicateDecision } from "./import-conflict-preferences";

export interface ContentDuplicateDialogProps {
  conflicts: ImportConflictPlan;
  decision: RememberedDuplicateDecision;
  remember: boolean;
  onDecisionChange: (value: RememberedDuplicateDecision) => void;
  onRememberChange: (value: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Library / content duplicates only (Serpent-glua / zp8q). */
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
  const examples = conflicts.examples.filter(
    (item) =>
      item.kind === "suspected-duplicate" || item.kind === "library-duplicate",
  );
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="content-duplicate-dialog-title"
        aria-modal="true"
        className="conflict-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="content-duplicate-dialog-title">
              {t("dialog.contentDuplicate.title")}
            </h2>
          </div>
        </div>
        <div className="conflict-summary">
          <div>
            <strong>{conflicts.suspectedDuplicateCount}</strong>
            <span>{t("dialog.contentDuplicate.countLabel")}</span>
          </div>
          {conflicts.libraryDuplicateCount > 0 ? (
            <div>
              <strong>{conflicts.libraryDuplicateCount}</strong>
              <span>{t("dialog.conflicts.libraryDuplicates")}</span>
            </div>
          ) : null}
        </div>
        <label className="decision-field" htmlFor="content-duplicate-decision">
          <span>{t("dialog.contentDuplicate.actionLabel")}</span>
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
        </label>
        <label
          className="ai-config-check-row"
          htmlFor="content-duplicate-remember"
        >
          <input
            checked={remember}
            id="content-duplicate-remember"
            onChange={(event) => onRememberChange(event.target.checked)}
            type="checkbox"
          />
          <span>{t("dialog.contentDuplicate.remember")}</span>
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
