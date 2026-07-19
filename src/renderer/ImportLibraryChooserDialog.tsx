import { type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface ImportLibraryChooserDialogProps {
  open: boolean;
  onImportFolder: () => void;
  onImportZip: () => void;
  onCancel: () => void;
}

/**
 * Empty-start / onboarding chooser (Serpent-bqi): one "Import library" entry
 * explains folder vs ZIP before launching the existing import flows.
 */
export function ImportLibraryChooserDialog({
  open,
  onImportFolder,
  onImportZip,
  onCancel,
}: ImportLibraryChooserDialogProps): ReactNode {
  const t = useT();
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-labelledby="import-library-chooser-title"
        aria-modal="true"
        className="create-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="import-library-chooser-title">
              {t("dialog.importLibraryChooser.title")}
            </h2>
          </div>
          <button
            className="dialog-close"
            onClick={onCancel}
            type="button"
            {...iconActionAttrs(t("common.cancel"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="field-help">{t("dialog.importLibraryChooser.help")}</p>
        <div className="dialog-actions is-stacked">
          <button
            className="primary-button"
            onClick={onImportFolder}
            type="button"
          >
            <Icon name="folder" size={15} />
            {t("dialog.importLibraryChooser.folder")}
          </button>
          <button
            className="secondary-button"
            onClick={onImportZip}
            type="button"
          >
            <Icon name="archive" size={15} />
            {t("dialog.importLibraryChooser.zip")}
          </button>
          <button
            className="secondary-button"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
