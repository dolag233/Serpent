import React from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";
import { DialogShell } from "./ui/patterns";

export interface PermanentDeleteDialogProps {
  assetCount: number;
  onCancel: () => void;
  onConfirm: () => void;
}

export function PermanentDeleteDialog({
  assetCount,
  onCancel,
  onConfirm,
}: PermanentDeleteDialogProps) {
  const t = useT();
  return (
    <div className="dialog-backdrop" role="presentation">
      <DialogShell
        className="create-dialog"
        dialogId="permanent-delete-dialog"
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
        style={{ padding: 0 }}
        title={t("dialog.permanentDelete.title")}
      >
        <p className="dialog-body-copy">
          {t("dialog.permanentDelete.body", { count: assetCount })}
        </p>
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
            onClick={onConfirm}
            type="button"
          >
            {t("dialog.permanentDelete.submit", { count: assetCount })}
          </button>
        </div>
      </DialogShell>
    </div>
  );
}
