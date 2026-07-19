import React, { useState } from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface DiskDeleteConfirmDialogProps {
  /** Folder or subject display name shown in the body. */
  subjectName: string;
  /** Override body copy; defaults to folder disk-delete wording. */
  bodyKey?: "dialog.diskDelete.body" | "dialog.diskDelete.libraryBody";
  onCancel: () => void;
  onConfirm: (dontShowAgain: boolean) => void;
}

/**
 * Irreversible "delete from disk" confirmation (clarification #7).
 * Shared by managed/linked-child folder delete and library delete (Serpent-9i8).
 */
export function DiskDeleteConfirmDialog({
  subjectName,
  bodyKey = "dialog.diskDelete.body",
  onCancel,
  onConfirm,
}: DiskDeleteConfirmDialogProps) {
  const t = useT();
  const [dontShowAgain, setDontShowAgain] = useState(false);
  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{t("dialog.diskDelete.title")}</h2>
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
        <p
          style={{
            color: "var(--secondary)",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {t(bodyKey, { name: subjectName })}
        </p>
        <label
          className="field-help"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            cursor: "pointer",
          }}
        >
          <input
            checked={dontShowAgain}
            onChange={(event) => setDontShowAgain(event.target.checked)}
            type="checkbox"
          />
          {t("dialog.diskDelete.dontShowAgain")}
        </label>
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
            onClick={() => onConfirm(dontShowAgain)}
            type="button"
          >
            {t("dialog.diskDelete.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
