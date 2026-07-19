import { useState, type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface ExportDialogProps {
  open: boolean;
  exporting: boolean;
  onClose: () => void;
  onExportFolder: (includeLinkedContent: boolean) => void;
  onExportZip: (includeLinkedContent: boolean) => void;
}

/**
 * Library export chooser — same stacked folder/ZIP pattern as
 * ImportLibraryChooserDialog (Serpent-ec5).
 */
export function ExportDialog({
  open,
  exporting,
  onClose,
  onExportFolder,
  onExportZip,
}: ExportDialogProps): ReactNode {
  const t = useT();
  const [includeLinkedContent, setIncludeLinkedContent] = useState(false);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="export-library-chooser-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="export-library-chooser-title">
              {t("toolbar.exportLibrary")}
            </h2>
          </div>
          <button
            className="dialog-close"
            disabled={exporting}
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">
          {t("dialog.export.help")}{" "}
          {t("dialog.export.zipLimitHint")}
        </p>
        <label className="ai-config-check-row ai-config-check-row-top">
          <input
            checked={includeLinkedContent}
            disabled={exporting}
            onChange={(event) => setIncludeLinkedContent(event.target.checked)}
            type="checkbox"
          />
          <span className="app-settings-check-copy">
            <span>{t("dialog.export.includeLinked")}</span>
          </span>
        </label>
        <div className="dialog-actions is-stacked">
          <button
            className="primary-button"
            disabled={exporting}
            onClick={() => onExportFolder(includeLinkedContent)}
            type="button"
          >
            <Icon name="folder" size={15} />
            {t("dialog.export.folder")}
          </button>
          <button
            className="secondary-button"
            disabled={exporting}
            onClick={() => onExportZip(includeLinkedContent)}
            type="button"
          >
            <Icon name="archive" size={15} />
            {t("dialog.export.zip")}
          </button>
          <button
            className="secondary-button"
            disabled={exporting}
            onClick={onClose}
            type="button"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
