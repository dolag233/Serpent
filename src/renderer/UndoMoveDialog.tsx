import { Icon } from "./Icons";
import { useT } from "./i18n";

export interface UndoMoveDialogProps {
  open: boolean;
  conflictStrategy: "keep-both" | "replace" | "skip";
  onConflictStrategyChange: (
    strategy: "keep-both" | "replace" | "skip",
  ) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UndoMoveDialog({
  open,
  conflictStrategy,
  onConflictStrategyChange,
  onConfirm,
  onCancel,
}: UndoMoveDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="undo-move-dialog-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="undo-move-dialog-title">{t("dialog.undoMove.title")}</h2>
          </div>
          <button
            aria-label={t("dialog.undoMove.cancelAria")}
            className="dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">{t("dialog.undoMove.help")}</p>
        <label className="field-label" htmlFor="undo-move-conflict">
          {t("dialog.undoMove.conflictLabel")}
        </label>
        <select
          className="text-field"
          id="undo-move-conflict"
          onChange={(event) =>
            onConflictStrategyChange(
              event.target.value as "keep-both" | "replace" | "skip",
            )
          }
          value={conflictStrategy}
        >
          <option value="keep-both">{t("dialog.undoMove.keepBoth")}</option>
          <option value="replace">{t("dialog.undoMove.replace")}</option>
          <option value="skip">{t("dialog.undoMove.skip")}</option>
        </select>
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
            {t("dialog.undoMove.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
