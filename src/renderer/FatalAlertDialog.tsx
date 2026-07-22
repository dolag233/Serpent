import React from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface FatalAlertDialogProps {
  /** Body text; dialog is closed when null/empty. */
  message: string | null;
  /** Optional title override (Serpent-4sw0: AI uses plain wording). */
  title?: string | null;
  onDismiss: () => void;
}

/**
 * Blocking fatal alert (Serpent-99lv). Not a toast — user must acknowledge
 * before continuing. Escape / close / confirm all dismiss.
 */
export function FatalAlertDialog({
  message,
  title,
  onDismiss,
}: FatalAlertDialogProps) {
  const t = useT();
  if (!message) return null;

  const heading = title?.trim() ? title : t("dialog.fatalAlert.title");

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        aria-describedby="fatal-alert-body"
        aria-labelledby="fatal-alert-title"
        aria-modal="true"
        className="create-dialog"
        role="alertdialog"
      >
        <div className="dialog-heading">
          <div>
            <h2 id="fatal-alert-title">{heading}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onDismiss}
            type="button"
            {...iconActionAttrs(t("dialog.fatalAlert.confirm"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p
          id="fatal-alert-body"
          style={{
            color: "var(--secondary)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {message}
        </p>
        <div className="dialog-actions">
          <button className="primary-button" onClick={onDismiss} type="button">
            {t("dialog.fatalAlert.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
