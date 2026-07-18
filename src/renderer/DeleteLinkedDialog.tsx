import React from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

export interface DeleteLinkedDialogProps {
  displayNames: string;
  deleteSourceFile: boolean;
  canDeleteSourceFile: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onToggleDeleteSourceFile: (checked: boolean) => void;
}

export function DeleteLinkedDialog({
  displayNames,
  deleteSourceFile,
  canDeleteSourceFile,
  onClose,
  onConfirm,
  onToggleDeleteSourceFile,
}: DeleteLinkedDialogProps) {
  const t = useT();
  return (
    <div className="dialog-backdrop" role="presentation">
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{t("dialog.deleteLinked.title")}</h2>
          </div>
          <button
            className="dialog-close"
            onClick={onClose}
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
          {t("dialog.deleteLinked.body", { name: displayNames })}
        </p>
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 12,
            color: "var(--secondary)",
            fontSize: 12,
            cursor: canDeleteSourceFile
              ? "pointer"
              : "not-allowed",
            lineHeight: 1.5,
          }}
        >
          <input
            aria-label={t("dialog.deleteLinked.deleteSourceAria")}
            checked={deleteSourceFile}
            disabled={!canDeleteSourceFile}
            onChange={(event) =>
              onToggleDeleteSourceFile(event.target.checked)
            }
            type="checkbox"
          />
          <span>
            {canDeleteSourceFile
              ? t("dialog.deleteLinked.deleteSourceHelp")
              : t("dialog.deleteLinked.sourceUnavailable")}
          </span>
        </label>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            onClick={onClose}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary-button"
            onClick={onConfirm}
            type="button"
          >
            {deleteSourceFile
              ? t("dialog.deleteLinked.submitWithTrash")
              : t("dialog.deleteLinked.submitRecordOnly")}
          </button>
        </div>
      </div>
    </div>
  );
}
