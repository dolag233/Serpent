import { Icon } from "./Icons";
import { useT } from "./i18n";

export interface MoveDialogProps {
  assetIds: string[];
  folders: Array<{
    folderId: string;
    name: string;
    relativePath: string;
  }>;
  targetFolderId: string | null;
  conflictStrategy: "keep-both" | "replace" | "skip";
  onTargetChange: (folderId: string | null) => void;
  onStrategyChange: (strategy: "keep-both" | "replace" | "skip") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MoveDialog({
  assetIds,
  folders,
  targetFolderId,
  conflictStrategy,
  onTargetChange,
  onStrategyChange,
  onConfirm,
  onCancel,
}: MoveDialogProps) {
  const t = useT();
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="move-dialog-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="move-dialog-title">
              {t("dialog.move.title", { count: assetIds.length })}
            </h2>
          </div>
          <button
            aria-label={t("dialog.move.cancelAria")}
            className="dialog-close"
            onClick={onCancel}
            type="button"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <label className="field-label" htmlFor="move-target">
          {t("dialog.move.targetFolder")}
        </label>
        <select
          className="text-field"
          id="move-target"
          onChange={(event) =>
            onTargetChange(event.target.value || null)
          }
          value={targetFolderId ?? ""}
        >
          <option value="">{t("scope.rootFolder")}</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath}
            </option>
          ))}
        </select>
        <label
          className="field-label"
          htmlFor="move-conflict"
          style={{ marginTop: 12 }}
        >
          {t("dialog.move.nameConflict")}
        </label>
        <select
          className="text-field"
          id="move-conflict"
          onChange={(event) =>
            onStrategyChange(
              event.target.value as MoveDialogProps["conflictStrategy"],
            )
          }
          value={conflictStrategy}
        >
          <option value="keep-both">{t("dialog.move.keepBoth")}</option>
          <option value="replace">{t("dialog.move.replace")}</option>
          <option value="skip">{t("dialog.move.skip")}</option>
        </select>
        <p className="field-help">{t("dialog.move.help")}</p>
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
            {t("dialog.move.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
