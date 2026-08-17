import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface RestoreDialogProps {
  assetIds: string[];
  folders: Array<{
    folderId: string;
    relativePath: string;
  }>;
  target: "original" | "root" | string;
  conflictStrategy: "keep-both" | "replace" | "skip";
  onTargetChange: (target: "original" | "root" | string) => void;
  onStrategyChange: (strategy: "keep-both" | "replace" | "skip") => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreDialog({
  assetIds,
  folders,
  target,
  conflictStrategy,
  onTargetChange,
  onStrategyChange,
  onConfirm,
  onCancel,
}: RestoreDialogProps) {
  const t = useT();
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="restore-dialog"
        headerActions={
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onCancel}
        title={t("dialog.restore.title", { count: assetIds.length })}
      >
        <label className="field-label" htmlFor="restore-target">
          {t("dialog.restore.location")}
        </label>
        <select
          className="text-field"
          id="restore-target"
          onChange={(event) =>
            onTargetChange(
              event.target.value as "original" | "root" | string,
            )
          }
          value={target}
        >
          <option value="original">{t("dialog.restore.original")}</option>
          <option value="root">{t("scope.rootFolder")}</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath}
            </option>
          ))}
        </select>
        <label
          className="field-label field-label-spaced"
          htmlFor="restore-conflict"
        >
          {t("dialog.restore.nameConflict")}
        </label>
        <select
          className="text-field"
          id="restore-conflict"
          onChange={(event) =>
            onStrategyChange(
              event.target.value as "keep-both" | "replace" | "skip",
            )
          }
          value={conflictStrategy}
        >
          <option value="keep-both">{t("dialog.restore.keepBoth")}</option>
          <option value="replace">{t("dialog.restore.replace")}</option>
          <option value="skip">{t("dialog.restore.skip")}</option>
        </select>
        {conflictStrategy === "replace" && (
          <p className="field-help">{t("dialog.restore.replaceHelp")}</p>
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
            {t("dialog.restore.submit")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
