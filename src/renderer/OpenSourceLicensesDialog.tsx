import { type ReactNode } from "react";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

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
      <div
        aria-labelledby="open-source-dialog-title"
        aria-modal="true"
        className="create-dialog open-source-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="open-source-dialog-title">{t("dialog.openSource.title")}</h2>
            <p className="app-log-subtitle">{t("dialog.openSource.subtitle")}</p>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
            type="button"
            {...iconActionAttrs(t("dialog.openSource.closeAria"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
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
      </div>
    </div>
  );
}
