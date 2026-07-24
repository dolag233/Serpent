import React from "react";
import { Icon } from "./Icons";
import { iconActionAttrs } from "./icon-action-attrs";
import { useT } from "./i18n";

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
      <div aria-modal="true" className="create-dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <h2>{t("dialog.permanentDelete.title")}</h2>
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
      </div>
    </div>
  );
}
