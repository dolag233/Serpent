import { type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export type OpenSourceLicensesDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
};

export function OpenSourceLicensesDialog({
  open,
  onClose,
}: OpenSourceLicensesDialogProps): ReactNode {
  const t = useT();
  if (!open) return null;

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <DialogShell
        className="create-dialog open-source-dialog"
        dialogId="open-source-licenses"
        description={
          <span className="app-log-subtitle">
            {t("dialog.openSource.subtitle")}
          </span>
        }
        headerActions={
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.openSource.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        }
        onRequestClose={onClose}
        style={{ padding: 0 }}
        title={t("dialog.openSource.title")}
      >
        <div className="open-source-dialog-content">
          <p className="field-help">{t("dialog.openSource.intro")}</p>
          <ul>
            <li><strong>Electron</strong><span>{t("dialog.openSource.electron")}</span></li>
            <li><strong>React</strong><span>{t("dialog.openSource.react")}</span></li>
            <li><strong>SQLite / better-sqlite3</strong><span>{t("dialog.openSource.sqlite")}</span></li>
            <li><strong>FFmpeg / OpenImageIO</strong><span>{t("dialog.openSource.media")}</span></li>
          </ul>
          <p className="field-help">{t("dialog.openSource.license")}</p>
        </div>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onClose} type="button">
            {t("dialog.openSource.close")}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
