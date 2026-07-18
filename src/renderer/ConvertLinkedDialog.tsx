import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface ConvertLinkedDialogProps {
  folderName: string;
  targetFolderId: string;
  folders: { folderId: string; relativePath: string }[];
  onCancel: () => void;
  onTargetChange: (targetFolderId: string) => void;
  onConfirm: () => void;
}

export function ConvertLinkedDialog({
  folderName,
  targetFolderId,
  folders,
  onCancel,
  onTargetChange,
  onConfirm,
}: ConvertLinkedDialogProps) {
  const t = useT();
  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{t("dialog.convertLinked.title", { name: folderName })}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("dialog.convertLinked.cancelAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">{t("dialog.convertLinked.help")}</p>
        <select
          className="text-field"
          onChange={(event) => onTargetChange(event.target.value)}
          value={targetFolderId}
        >
          <option value="">{t("scope.rootFolder")}</option>
          {folders.map((folder) => (
            <option key={folder.folderId} value={folder.folderId}>
              {folder.relativePath}
            </option>
          ))}
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
            onClick={() => void onConfirm()}
            type="button"
          >
            {t("dialog.convertLinked.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
