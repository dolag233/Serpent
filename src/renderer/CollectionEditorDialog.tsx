import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface CollectionEditorDialogProps {
  open: boolean;
  description: string;
  coverAssetId: string;
  assetOptions: Array<{ assetId: string; displayName: string }>;
  onDescriptionChange: (d: string) => void;
  onCoverAssetChange: (id: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function CollectionEditorDialog({
  open,
  description,
  coverAssetId,
  assetOptions,
  onDescriptionChange,
  onCoverAssetChange,
  onSave,
  onCancel,
}: CollectionEditorDialogProps) {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="collection-editor"
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
        title={t("dialog.collectionEditor.title")}
        style={{ padding: 0 }}
      >
        <label className="field-label" htmlFor="collection-description">
          {t("dialog.collectionEditor.description")}
        </label>
        <textarea
          className="text-field"
          id="collection-description"
          maxLength={10000}
          onChange={(event) => onDescriptionChange(event.target.value)}
          rows={4}
          value={description}
        />
        <label
          className="field-label field-label-spaced"
          htmlFor="collection-cover"
        >
          {t("dialog.collectionEditor.cover")}
        </label>
        <select
          className="text-field"
          id="collection-cover"
          onChange={(event) => onCoverAssetChange(event.target.value)}
          value={coverAssetId}
        >
          <option value="">{t("dialog.collectionEditor.noCover")}</option>
          {coverAssetId &&
            !assetOptions.some((a) => a.assetId === coverAssetId) && (
              <option value={coverAssetId}>
                {t("dialog.collectionEditor.currentCoverOffPage")}
              </option>
            )}
          {assetOptions.map((asset) => (
            <option key={asset.assetId} value={asset.assetId}>
              {asset.displayName}
            </option>
          ))}
        </select>
        <p className="field-help">{t("dialog.collectionEditor.help")}</p>
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
            onClick={onSave}
            type="button"
          >
            {t("dialog.collectionEditor.save")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
