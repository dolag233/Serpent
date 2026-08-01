import appIcon from "../../assets/icons/app.png";

import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { type ReactNode } from "react";

export type AboutDialogProps = {
  readonly open: boolean;
  readonly version: string;
  readonly onClose: () => void;
  readonly onOpenGitHub: () => void;
};

export function AboutDialog({
  open,
  version,
  onClose,
  onOpenGitHub,
}: AboutDialogProps): ReactNode {
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
        aria-labelledby="about-dialog-title"
        aria-modal="true"
        className="create-dialog about-dialog"
        role="dialog"
      >
        <button
          className="about-dialog-close"
          onClick={onClose}
          type="button"
          {...iconActionAttrs(t("dialog.about.closeAria"))}
        >
          <Icon name="close" size={16} />
        </button>
        <div className="about-dialog-brand">
          <img alt={t("dialog.about.logoAlt")} src={appIcon} />
          <h2 id="about-dialog-title">{t("dialog.about.productName")}</h2>
          <p>{t("dialog.about.tagline")}</p>
          <span>{t("dialog.about.version", { version })}</span>
        </div>
        <div className="about-dialog-copy">
          <p>{t("dialog.about.description")}</p>
        </div>
        <div className="about-dialog-actions">
          <button className="secondary-button" onClick={onOpenGitHub} type="button">
            <Icon name="globe" size={14} />
            {t("dialog.about.github")}
          </button>
          <button className="primary-button" onClick={onClose} type="button">
            {t("dialog.about.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
