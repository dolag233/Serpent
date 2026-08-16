import { useState, type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";
import { cx } from "./ui/primitives/cx";

export interface ImportLibraryChooserDialogProps {
  open: boolean;
  onImportFolder: () => void;
  onImportZip: () => void;
  /** Convert an Eagle library into a new Serpent library (open, not merge). */
  onOpenEagle?: () => void;
  onCancel: () => void;
}

/**
 * Empty-start / onboarding chooser (Serpent-bqi): one "Import library" entry
 * explains folder vs ZIP, and can expand to open an Eagle library as a new
 * Serpent library (the no-library sense of "import external").
 */
export function ImportLibraryChooserDialog({
  open,
  onImportFolder,
  onImportZip,
  onOpenEagle,
  onCancel,
}: ImportLibraryChooserDialogProps): ReactNode {
  const t = useT();
  const [externalOpen, setExternalOpen] = useState(false);
  // 关闭对话框时重置折叠态：用渲染期状态调整（React 官方模式），
  // 避免在 effect 内同步 setState。
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (!open) setExternalOpen(false);
  }

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
            aria-expanded={externalOpen}
            className="secondary-button import-chooser-disclosure"
            onClick={() => setExternalOpen((current) => !current)}
            type="button"
          >
            <span>{t("dialog.importLibraryChooser.external")}</span>
            <span
              aria-hidden="true"
              className={cx(
                "app-settings-disclosure-chevron",
                externalOpen && "is-open",
              )}
            >
              <Icon name="chevron" size={16} />
            </span>
          </button>
          {externalOpen ? (
            <>
              <button
                className="secondary-button"
                disabled={!onOpenEagle}
                onClick={() => onOpenEagle?.()}
                type="button"
              >
                <Icon name="box" size={15} />
                {t("shell.openEagleLibraryEllipsis")}
              </button>
              <button
                className="secondary-button"
                disabled
                type="button"
              >
                <Icon name="box" size={15} />
                {t("shell.openBillfishLibraryEllipsis")}
              </button>
            </>
          ) : null}
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
