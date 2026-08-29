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
  /** Keeps a failed library open recoverable without requiring a relaunch. */
  onSwitchLibrary?: () => void;
}

/**
 * Blocking error alert (Serpent-99lv). Not a toast — user must acknowledge
 * before continuing. Title names the operation (import, open library, etc.).
 */
export function FatalAlertDialog({
  message,
  title,
  onDismiss,
  onSwitchLibrary,
}: FatalAlertDialogProps) {
  const t = useT();
  if (!message) return null;

  const heading =
    title?.trim() || t("dialog.blockingError.fallback");

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
            {...iconActionAttrs(t("dialog.blockingError.confirm"))}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <p className="dialog-body-copy" id="fatal-alert-body">
          {message}
        </p>
        <div className="dialog-actions">
          {onSwitchLibrary ? (
            <button className="secondary-button" onClick={onSwitchLibrary} type="button">
              {t("dialog.blockingError.switchLibrary")}
            </button>
          ) : null}
          <button className="primary-button" onClick={onDismiss} type="button">
            {t("dialog.blockingError.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
