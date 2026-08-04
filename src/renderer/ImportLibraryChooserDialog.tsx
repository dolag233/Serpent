import { type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

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
      <DialogShell
        className="create-dialog"
        dialogId="import-library-chooser"
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
        title={t("dialog.importLibraryChooser.title")}
      >
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
      </DialogShell>
    </div>
  );
}
